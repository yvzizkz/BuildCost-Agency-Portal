/**
 * dispatch.mjs — the command-dispatch DECISION layer (pure, testable).
 *
 * Maps a portal `commands/{id}` doc to the EXACT existing engine CLI invocation,
 * or rejects it. This is the security boundary for Loop 2 (Firestore -> engine):
 * type allow-list, payload validation/sanitization, fixed argv templates (never
 * raw owner strings as flags), and the HARD exclusion of any send/publish/spend
 * path. It builds argv only — bridge.mjs does the execFile + Firestore writes.
 *
 * No engine code is called or imported here; it only constructs argv arrays for
 * scripts that already exist in the engine repo. Pure + side-effect-free so it
 * can be unit-tested without Firebase and without mutating the live queue.
 *
 * Guarantees encoded here (what the engine relies on):
 *   - allow-list: approve | reject | requestGeneration. submitContent is the
 *     separate submissions path and is refused here.
 *   - producers are invoked draft-only (`--mode draft`); studio/reel expose no
 *     send/publish/spend mode, and meta_ads/activate is NEVER in any template.
 *   - owner strings (notes, project, slot) are validated/sanitized and passed as
 *     discrete argv items (execFile argv array — no shell interpolation anywhere).
 */
import path from "node:path";

// Engine script locations, relative to the tenant's repoRoot.
const SCRIPTS = {
  approvalFlow: ".claude/skills/approval-flow/approval_flow.py",
  studio: ".claude/skills/studio/studio.py",
  reel: ".claude/skills/asset-studio/reel.py",
  strategyPlanner: ".claude/skills/content-strategy/strategy_planner.py",
};

const PYTHON = process.env.PORTAL_PYTHON || "python3";

// queueIds look like `saddlewood-2026-W26-post-1` (mixed case from ISO week W).
const QUEUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
// project / slot ids are engine slugs: `mccormick-ranch-kitchen-bath`, `reel`.
const SLUG_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const NOTES_MAX = 500;

const GENERATORS = new Set(["social", "reel"]);
const ALLOWED_TYPES = new Set(["approve", "reject", "requestGeneration", "editCaption", "generateSlot"]);
const MAX_SLOT_N = 200;   // a 30-day plan has ≤ ~30 slots; this is a generous sanity bound.

// Caption editing limits. Body keeps line breaks; hashtags/CTA are single-line.
const CAPTION_MAX = 3000;
const HASHTAGS_MAX = 600;
const CTA_MAX = 200;

// The ONLY `--media` values the portal may request — the studio vocabulary, exactly.
// A specific format => exactly one draft (studio's `--slot` forces 1 post + a stable id).
// `card` is intentionally excluded: studio requires `--card-text`, which the portal flow
// does not collect, so a card request would always fail — reject it cleanly at the boundary.
const SOCIAL_MEDIA = new Set([
  "single", "vision", "carousel",
  "collage:before-after", "collage:grid-2x2", "collage:process-journey",
  "collage:feature-trio", "collage:reveal",
]);

function fail(error) {
  return { ok: false, error };
}

// Dropbox-ingest host allow-list (SSRF guard). Only Dropbox share hosts and their
// download CDN are accepted; the bridge re-validates EVERY redirect hop against this.
const DROPBOX_HOST_RE = /(^|\.)dropbox\.com$/i;
const DROPBOX_DL_HOST_RE = /(^|\.)dropboxusercontent\.com$/i;

/** True if host is a Dropbox share host or its download CDN (dl.dropboxusercontent.com etc). */
export function isDropboxHost(host) {
  const h = String(host || "").toLowerCase();
  return DROPBOX_HOST_RE.test(h) || DROPBOX_DL_HOST_RE.test(h);
}

/** Reduce an arbitrary string to a safe Drive filename (basename only, no path traversal). */
function safeFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 180);
  return cleaned || "";
}

/**
 * Validate + normalize an owner-supplied ingest link (Dropbox only, for now). Returns
 * { ok:true, value:{ source, url, name } } with the URL forced to direct-download (dl=1)
 * and a safe filename, or { ok:false, error }. This is the boundary validator for
 * `ingestLink` commands — the SSRF allow-list + https-only check live here so they are
 * unit-testable without Firebase or network. The bridge fetch re-checks every redirect.
 */
export function cleanIngestLink(payload) {
  const source = String(payload?.source || "");
  if (source !== "dropbox") return fail(`unsupported ingest source: ${source || "(none)"}`);
  let u;
  try { u = new URL(String(payload?.url || "")); } catch { return fail("invalid URL"); }
  if (u.protocol !== "https:") return fail("ingest link must be https");
  if (!isDropboxHost(u.hostname)) return fail("only Dropbox share links are supported");
  // Force a direct download for share-page links (dl=1); the CDN host already serves bytes.
  if (DROPBOX_HOST_RE.test(u.hostname.toLowerCase())) u.searchParams.set("dl", "1");
  let raw = "";
  try { raw = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || ""); } catch { raw = ""; }
  const name = safeFileName(raw) || "dropbox-file";
  return { ok: true, value: { source, url: u.toString(), name } };
}

/** Trim, strip control chars, collapse whitespace, cap length. */
function cleanNotes(s) {
  return String(s == null ? "" : s)
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTES_MAX);
}

/** Caption body: strip control chars EXCEPT newline/tab, collapse spaces, cap blank lines + length. */
function cleanCaption(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, CAPTION_MAX);
}

/** Single-line clean (hashtags, CTA) — no newlines. */
function cleanLine(s, max) {
  return String(s == null ? "" : s)
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Validate + normalize an owner caption edit for the engine. Returns the cleaned
 * {body, hashtags[], cta} (hashtags as an ARRAY — the engine draft's shape) or null
 * if nothing meaningful was supplied. This is the boundary validator for editCaption
 * payloads, mirroring cleanNotes' discipline for reject.
 */
export function cleanEditCopy(copy) {
  const c = copy && typeof copy === "object" ? copy : {};
  const body = cleanCaption(c.body);
  const hashtagsStr = cleanLine(c.hashtags, HASHTAGS_MAX);
  const hashtags = hashtagsStr ? hashtagsStr.split(/\s+/).filter(Boolean) : [];
  const cta = cleanLine(c.cta, CTA_MAX);
  if (!body && hashtags.length === 0 && !cta) return null;
  return { body, hashtags, cta };
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** Extract the engine's "Publish path:" / "Send path:" line from approve stdout. */
function parseApprove(stdout) {
  const out = { approved: true };
  for (const line of String(stdout || "").split("\n")) {
    const m = line.match(/^(Publish path|Send path):\s*(.+)$/);
    if (m) { out.publishPath = m[2].trim(); break; }
  }
  return out;
}

function parseOk(stdout) {
  return { ok: true, summary: String(stdout || "").trim().split("\n").pop() || "" };
}

/** generate-slot prints a single --json result object. Parse it; fall back to a summary line. */
function parseGenerateSlot(stdout) {
  const txt = String(stdout || "").trim();
  try {
    const obj = JSON.parse(txt);
    if (obj && typeof obj === "object") return obj;
  } catch { /* not JSON — fall through */ }
  return { ok: true, summary: txt.split("\n").pop() || "" };
}

/**
 * @param {{repoRoot:string, env:string, slug:string}} tenant  resolved from the tenant map
 * @param {string} type      command type (from the Firestore doc)
 * @param {object} payload   command payload
 * @returns {{ok:true, exec:{file:string, argv:string[], cwd:string, parse:Function, label:string}} | {ok:false, error:string}}
 */
export function buildDispatch(tenant, type, payload = {}) {
  if (!tenant || !SLUG_RE.test(tenant.slug || "")) return fail("invalid or unresolved tenant/brand");
  if (!ALLOWED_TYPES.has(type)) {
    if (type === "submitContent") return fail("submitContent is handled by the submissions path, not commands");
    return fail(`type not allowed: ${type}`);
  }
  const slug = tenant.slug;
  const abs = (rel) => path.join(tenant.repoRoot, rel);
  const base = { file: PYTHON, cwd: tenant.repoRoot };

  if (type === "approve") {
    const qid = String(payload.queueId || "");
    if (!QUEUE_ID_RE.test(qid)) return fail("approve requires a valid queueId");
    return {
      ok: true,
      exec: {
        ...base,
        label: `approve:${slug}:${qid}`,
        argv: [abs(SCRIPTS.approvalFlow), "--brand", slug, "--mode", "approve", "--id", qid],
        parse: parseApprove,
      },
    };
  }

  if (type === "reject") {
    const qid = String(payload.queueId || "");
    if (!QUEUE_ID_RE.test(qid)) return fail("reject requires a valid queueId");
    const notes = cleanNotes(payload.notes);
    if (!notes) return fail("reject requires notes (so the V2 regeneration is seeded)");
    return {
      ok: true,
      exec: {
        ...base,
        label: `reject:${slug}:${qid}`,
        argv: [abs(SCRIPTS.approvalFlow), "--brand", slug, "--mode", "reject", "--id", qid, "--notes", notes],
        parse: parseOk,
      },
    };
  }

  if (type === "editCaption") {
    const qid = String(payload.queueId || "");
    if (!QUEUE_ID_RE.test(qid)) return fail("editCaption requires a valid queueId");
    // The bridge has already validated+written the cleaned copy to this temp JSON file
    // (dispatch is pure/no-fs); we only thread its path. Engine stays draft-only.
    const copyFile = String(payload.copyFile || "");
    if (!copyFile) return fail("editCaption requires a copyFile path (internal)");
    return {
      ok: true,
      exec: {
        ...base,
        label: `editCaption:${slug}:${qid}`,
        argv: [abs(SCRIPTS.approvalFlow), "--brand", slug, "--mode", "edit-caption", "--id", qid, "--copy-file", copyFile],
        parse: parseOk,
      },
    };
  }

  if (type === "generateSlot") {
    // Fire ONE ready slot of a persisted strategy through the engine's draft producer.
    // The bridge can't resolve the slot itself (the mirrored slot is basenamed for
    // leak-safety), so it passes only (submissionId, slotN); the engine reads strategy.json,
    // resolves the source grounding, and shells studio/reel in --mode draft (draft-only,
    // refuses Phase-2 routes). No raw owner strings reach a flag — both are validated scalars.
    const sid = String(payload.submissionId || "");
    if (!QUEUE_ID_RE.test(sid)) return fail("generateSlot requires a valid submissionId");
    const n = Number(payload.slotN);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SLOT_N) return fail("generateSlot requires a slotN in 1..200");
    return {
      ok: true,
      exec: {
        ...base,
        label: `genSlot:${slug}:${sid}#${n}`,
        argv: [abs(SCRIPTS.strategyPlanner), "--brand", slug, "--submission-id", sid,
          "--mode", "generate-slot", "--slot-n", String(n), "--json"],
        parse: parseGenerateSlot,
      },
    };
  }

  // requestGeneration — fixed per-producer templates, draft-only, no raw args.
  const producer = String(payload.producer || "");
  if (!GENERATORS.has(producer)) return fail(`unknown producer: ${producer || "(none)"}`);

  if (producer === "social") {
    const argv = [abs(SCRIPTS.studio), "--brand", slug, "--mode", "draft"];
    // Optional: ground the run on a SPECIFIC reference project (a submission's project).
    if (payload.project != null && payload.project !== "") {
      if (!SLUG_ID_RE.test(String(payload.project))) return fail("invalid project id");
      argv.push("--project", String(payload.project));
    }
    // Optional: a SPECIFIC format => one draft with a per-format slot. Without media we keep
    // the original behavior (`--max N` over the brief's pillars).
    if (payload.media != null && payload.media !== "") {
      const media = String(payload.media);
      if (!SOCIAL_MEDIA.has(media)) return fail(`invalid media: ${media}`);
      const slot = media.includes(":") ? media.split(":")[1] : media;
      if (!SLUG_ID_RE.test(slot)) return fail("invalid media slot");
      argv.push("--media", media, "--slot", slot);
    } else {
      const max = clampInt(payload.max, 1, 3, 1);
      argv.push("--max", String(max));
    }
    return {
      ok: true,
      exec: { ...base, label: `gen:social:${slug}`, argv, parse: parseOk },
    };
  }

  // producer === "reel"
  const argv = [abs(SCRIPTS.reel), "--brand", slug, "--mode", "draft"];
  if (payload.project != null && payload.project !== "") {
    if (!SLUG_ID_RE.test(String(payload.project))) return fail("invalid project id");
    argv.push("--project", String(payload.project));
  }
  if (payload.slot != null && payload.slot !== "") {
    if (!SLUG_ID_RE.test(String(payload.slot))) return fail("invalid slot");
    argv.push("--slot", String(payload.slot));
  }
  if (payload.premium === true) argv.push("--premium");
  return {
    ok: true,
    exec: { ...base, label: `gen:reel:${slug}`, argv, parse: parseOk },
  };
}

// --------------------------------------------------------------------------- //
// Phase 2/3 — post-intake pipeline (triage -> strategy). Pure argv builder, same
// security discipline as buildDispatch: validate every owner string, pass discrete
// argv items (no shell), and keep the spend path structurally absent.
// --------------------------------------------------------------------------- //
const MOTIVATION_RE = /^[a-z][a-z0-9_]{0,40}$/;          // a submission-templates motivation key
const PIPELINE_CHANNELS = new Set(["organic", "ads", "both"]);
const PIPELINE_OBJECTIVES = new Set(["awareness", "leads", "booked_jobs", "reviews"]);
const OFFER_MAX = 200;
const MUST_SAY_MAX = 5;

const PIPELINE_SCRIPTS = {
  triage: ".claude/skills/submission-triage/triage.py",
  strategy: ".claude/skills/content-strategy/strategy_planner.py",
};

/**
 * Build the post-intake DRAFT-ONLY pipeline argv (triage -> strategy) for a freshly
 * ingested submission. Pure + testable (no fs, no Firebase). Owner intent is OPTIONAL:
 * any field absent falls back to cold-start ('not_sure'), so this works before the
 * intent-capture form ships and gets richer once it does. NO spend path: triage runs
 * WITHOUT --enhance (no image-gen) and strategy WITHOUT --enrich (no AI); both are
 * draft-only and write only under growth-assets/submissions/<slug>/<id>/.
 *
 * @returns {{ok:true, triage:{argv:string[]}, strategy:{argv:string[]}} | {ok:false, error:string}}
 */
export function buildSubmissionPipeline(tenant, submissionId, projectId, intent = {}) {
  if (!tenant || !SLUG_RE.test(tenant.slug || "")) return fail("invalid or unresolved tenant/brand");
  if (!QUEUE_ID_RE.test(String(submissionId || ""))) return fail("invalid submissionId");
  if (!SLUG_ID_RE.test(String(projectId || ""))) return fail("invalid projectId");
  const slug = tenant.slug;
  const abs = (rel) => path.join(tenant.repoRoot, rel);

  const motivation = String(intent.motivation || "").trim() || "not_sure";
  if (!MOTIVATION_RE.test(motivation)) return fail(`invalid motivation: ${motivation}`);
  const horizon = intent.horizon === "month" ? "month" : "week";

  const triageArgv = [abs(PIPELINE_SCRIPTS.triage), "--brand", slug, "--from-project", projectId,
    "--submission-id", submissionId, "--motivation", motivation, "--mode", "triage"];
  if (intent.channel != null && intent.channel !== "") {
    if (!PIPELINE_CHANNELS.has(String(intent.channel))) return fail(`invalid channel: ${intent.channel}`);
    triageArgv.push("--channel", String(intent.channel));
  }
  if (intent.objective != null && intent.objective !== "") {
    if (!PIPELINE_OBJECTIVES.has(String(intent.objective))) return fail(`invalid objective: ${intent.objective}`);
    triageArgv.push("--objective", String(intent.objective));
  }
  const offer = cleanNotes(intent.offer).slice(0, OFFER_MAX);
  if (offer) triageArgv.push("--offer", offer);
  if (Array.isArray(intent.mustSay)) {
    for (const m of intent.mustSay.slice(0, MUST_SAY_MAX)) {
      const v = cleanNotes(m);
      if (v) triageArgv.push("--must-say", v);
    }
  }
  // Media-rights flags (the intent-capture form writes brief.mediaRights = {ownFootage, peopleInIt}).
  // These are store_true flags on triage.py — no owner string reaches a flag, just two booleans.
  const rights = (intent.mediaRights && typeof intent.mediaRights === "object") ? intent.mediaRights : {};
  if (rights.ownFootage === true) triageArgv.push("--own-footage");
  if (rights.peopleInIt === true) triageArgv.push("--people");

  const strategyArgv = [abs(PIPELINE_SCRIPTS.strategy), "--brand", slug,
    "--submission-id", submissionId, "--horizon", horizon, "--mode", "write"];

  return { ok: true, triage: { argv: triageArgv }, strategy: { argv: strategyArgv } };
}

export const _internals = { cleanNotes, clampInt, parseApprove, QUEUE_ID_RE, SLUG_ID_RE, GENERATORS };
