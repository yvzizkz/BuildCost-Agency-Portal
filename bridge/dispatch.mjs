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
};

const PYTHON = process.env.PORTAL_PYTHON || "python3";

// queueIds look like `saddlewood-2026-W26-post-1` (mixed case from ISO week W).
const QUEUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
// project / slot ids are engine slugs: `mccormick-ranch-kitchen-bath`, `reel`.
const SLUG_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const NOTES_MAX = 500;

const GENERATORS = new Set(["social", "reel"]);
const ALLOWED_TYPES = new Set(["approve", "reject", "requestGeneration", "editCaption"]);

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

export const _internals = { cleanNotes, clampInt, parseApprove, QUEUE_ID_RE, SLUG_ID_RE, GENERATORS };
