# BuildCost Agency Portal

A per-agency white-label owner portal (on `buildcost.info`) where business owners
submit field photos, approve/reject drafts, and track engagement. It is a **thin
projection + command surface** over the existing Enterprise growth engine — the
engine stays the source of truth.

> **This repo is a SEPARATE track from the engine.** It must NOT modify the
> producer skills, the brand registry schema, or the `review-queue.json` schema.
> The only coupling is the **bridge worker** (`bridge/`), which mirrors state and
> calls existing engine CLIs. The engine cannot send/publish/spend from here —
> those gates live engine-side.

## What's in this repo today (intake path)

This first slice implements **project/photo intake** end-to-end (the path that
replaced the abandoned GoHighLevel form). Owners submit photos in the portal; the
bridge mirrors them into the brand's reference library so the producer skills can
feature them.

```
agency-portal/
  firestore.rules        # client read-scoped; engine-authored collections are read-only
  storage.rules          # owner uploads (image/video, <25MB); generated media client-read-only
  bridge/
    tenants.json         # agencyId -> { repoRoot, env, brands{ brandId -> engine slug } }
    bridge.mjs           # Node + firebase-admin: Loop 2 listeners (submissions + commands).
                         #   Sole writer of Firestore state; all engine calls are argv-only.
    portal_intake.py     # the ONLY engine-touching file: imports brandlib (read-only) and
                         #   writes images + ONE pending projects.json record + ONE queue item
    dispatch.mjs         # pure command-dispatch decision layer (approve/reject/requestGeneration):
                         #   allow-list, validation/sanitization, fixed argv templates, spend-path exclusion
    package.json
  test/
    run_local_intake.py  # end-to-end intake smoke test WITHOUT Firebase (run this)
    test_portal_intake.py# intake edge-case unit tests (python)
    test_dispatch.mjs    # command-dispatch unit tests (node --test) — pure, no engine execution
    fixtures/            # sample submission.json
  scripts/seed.mjs       # Phase-1 manual Firestore seed (not run yet)
```

## Architecture (intake)

```
Owner browser ──upload──> Firebase Storage  agencies/{a}/brands/{b}/uploads/{uid}/{file}
            └──create───> Firestore  .../submissions/{id} { status:"requested", storagePaths[], title, … }
                              │
                              ▼  (Admin SDK; bypasses rules; single instance, serial per brand)
                          bridge.mjs ── claim(txn) → download photos → write submission.json
                              │
                              ▼  execFile (argv array, never shell)
                          portal_intake.py ── imports brandlib (read-only)
                              ├─ copy images → <engine>/brands/<slug>/reference/images/
                              ├─ append ONE record → reference/projects.json   (status:"pending")
                              └─ append ONE item   → growth-assets/review-queue.json  (type:"intake")
```

## The write contract (what producers consume)

`portal_intake.py` appends one record to `reference/projects.json → projects[]`,
in the exact shape the producer skills read (they tolerate empty `scope` /
`materials` / `signatureDetails` / `processImages`; `heroImage` + ≥1 gallery image
are the only hard requirements):

| field | source | notes |
|---|---|---|
| `id` | slugified `title`, deduped `-1/-2…` | unique within the brand |
| `title` | owner | required |
| `neighborhood` | owner → `--default-city` fallback | brand's `geo.primaryCity` |
| `heroImage` | owner-picked photo → else first | `images/<file>` (relative) |
| `galleryImages[]` | finished shots, hero first | ≥1 |
| `processImages[]` | photos flagged in-progress | omitted if none |
| `story` | owner note | `""` if blank |
| `scope[]` `materials[]` `signatureDetails[]` | owner (optional) → else `[]` | enriched on confirm |
| `heroDetail` | owner → first `signatureDetail` → `""` | proof anchor |
| `source` | `"portal-intake"` | provenance |
| `portalSubmissionId` | Firestore doc id | **dedup key** |
| `submittedAt` | submission timestamp | ISO-8601 |
| `status` | `"pending"` | confirm/enrich before featuring |

A submission is **dead-simple** (photos + title + neighborhood + note, pick hero,
flag in-progress shots). The record is written complete with structured fields
empty; one `type:"intake"` review-queue item asks the owner to confirm + enrich.
Producers run safely on the pending record immediately.

## Command dispatch — approve / reject / requestGeneration (Loop 2)

A second listener handles owner commands. The client creates a scoped, `requested`
`commands/{id}` doc (rules enforce shape + role); the worker claims it and dispatches
to an **existing** engine CLI. The decision layer (`bridge/dispatch.mjs`) is the
security boundary and is pure/testable:

| command | engine call | notes |
|---|---|---|
| `approve` | `approval_flow.py --brand <slug> --mode approve --id <queueId>` | marks approved + prints the publish/send path. **Never sends.** Success = exit 0; bridge parses the `Publish path:`/`Send path:` line. |
| `reject` | `approval_flow.py --brand <slug> --mode reject --id <queueId> --notes <notes>` | notes required + sanitized + length-capped; engine writes `revisionNotes` + `revisions[]`. |
| `requestGeneration` | `producer == social` → `studio.py --mode draft --max <1..3>`; `producer == reel` → `reel.py --mode draft [--project ..][--slot ..][--premium]` | fixed templates, params validated as engine slugs, **draft-only** — studio/reel expose no publish mode. |

Guarantees enforced in `dispatch.mjs` (covered by `test_dispatch.mjs`): type allow-list;
`queueId`/`project`/`slot` validated (injection-y values rejected, never passed through);
notes sanitized; **no template can emit `activate` / `--confirm` / `--i-understand-this-spends`
/ `meta_ads`** — the ad-spend path is structurally unreachable. `submitContent` via a command
is refused (it's the separate submissions path).

## Run the tests (no Firebase needed)

These point all writes at a throwaway sandbox; the live reference library and the
live review-queue are never touched. The python tests import the engine's `brandlib`
read-only from `--engine-root` (default `/Users/landos/Documents/Enterprise`, override
with `ENTERPRISE_ROOT`); the dispatch tests execute no engine code at all.

```bash
python3 test/run_local_intake.py          # intake end-to-end + idempotency
python3 test/test_portal_intake.py         # intake edge cases
node --test test/test_dispatch.mjs         # command-dispatch (18 cases)
python3 -m py_compile bridge/portal_intake.py && node --check bridge/bridge.mjs
```

## Run the bridge (only once a Firebase project + service account exist)

```bash
cd bridge && npm install
GOOGLE_APPLICATION_CREDENTIALS=./portal-bridge-sa.json \
  PORTAL_STORAGE_BUCKET=<project>.appspot.com node bridge.mjs
```

The `portal-bridge` service account uses the Admin SDK (bypasses security rules)
and is separate from the engine's GSC/Vertex SA. Run **exactly one** instance.

## Not in this repo yet

- **Loop 1 — mirror (engine → Firestore):** watch `growth-assets/review-queue.json`,
  resolve each draft, push media to Storage, upsert `queueItems`/`drafts` so the portal
  has a read view (and `requestGeneration` results surface). The command path above
  already works; this is what makes the queue *visible* in the portal.
- The Next.js UI + Firebase Auth (email magic-link) on Firebase App Hosting (Marco via `/orchestrate`).
- Creating the live Firebase project + `portal-bridge` Admin SA, and running `scripts/seed.mjs`.
```
