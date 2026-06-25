/**
 * mirror.mjs — Loop 1 projection logic (engine -> Firestore), pure + testable.
 *
 * Turns the engine's review-queue items + their draft files into Firestore-ready
 * `queueItems`/`drafts` docs and a list of media assets to push to Storage, plus
 * a content-hash + diff so the worker only writes on real change (no write storms)
 * and archives items that left the queue. No Firebase, no filesystem here —
 * bridge.mjs does the I/O; this only decides WHAT to write.
 */
import path from "node:path";
import crypto from "node:crypto";

// Fields copied verbatim from a queue item (omit anything we don't surface).
const QUEUE_FIELDS = [
  "queueId", "business", "type", "summary", "action", "publishCommand", "estMinutes",
  "status", "createdAt", "approvedAt", "rejectedAt", "revisionNotes", "ghlPostId",
  "ghlStatus", "scheduleDate", "pushedAt", "projectId", "source",
];
// Draft fields surfaced to the portal (critique/campaignPlan/motionPrompt are
// bulky internal reasoning — intentionally omitted; copy/QA are what owners review).
const DRAFT_FIELDS = [
  "draftId", "brand", "type", "status", "pillar", "media", "groundedProject",
  "neighborhood", "copy", "voiceCheck", "mediaQA", "createdAt",
];

function pick(obj, fields) {
  const o = {};
  for (const f of fields) if (obj && obj[f] !== undefined && obj[f] !== null) o[f] = obj[f];
  return o;
}

/** Reverse tenant lookup: engine slug -> { agencyId, brandId, repoRoot, env, slug } | null. */
export function resolveBrand(tenants, slug) {
  for (const [agencyId, a] of Object.entries(tenants || {})) {
    if (agencyId.startsWith("_") || !a || typeof a !== "object") continue;
    for (const [brandId, s] of Object.entries(a.brands || {})) {
      if (s === slug) return { agencyId, brandId, repoRoot: a.repoRoot, env: a.env, slug };
    }
  }
  return null;
}

/** Is item.link a per-draft JSON to resolve (vs intake's projects.json, or none)? */
export function isDraftLink(link) {
  if (!link || typeof link !== "string") return false;
  const norm = link.replace(/\\/g, "/");
  return norm.includes("/drafts/") && norm.endsWith(".json") && !norm.endsWith("/projects.json");
}

/**
 * Absolute path to a draft link, or null if it isn't a draft link. Queue items
 * carry EITHER an absolute link or one relative to the engine repoRoot (e.g. the
 * flyer producer writes a relative link) — resolve both so the draft is found.
 */
export function resolveDraftPath(repoRoot, link) {
  if (!isDraftLink(link)) return null;
  return path.isAbsolute(link) ? link : path.join(repoRoot || "", link);
}

/**
 * Project one queue item (+ optional resolved draft) into Firestore docs + assets.
 * @returns {{queueId, draftId:(string|null), queueItem, draft:(object|null), assets:object[]}}
 *   assets carry localPath (for upload) AND storagePath (for the doc); the draft
 *   doc's copy of assets omits localPath (never leak absolute FS paths to clients).
 */
export function projectItem(item, draft, scope) {
  const { agencyId, brandId } = scope;
  const draftId = (draft && draft.draftId) || null;

  const rawAssets = Array.isArray(draft && draft.assets) ? draft.assets : [];
  const assets = rawAssets
    .filter((a) => a && (a.kind === "image" || a.kind === "video") && typeof a.path === "string")
    .map((a) => {
      const fileName = path.basename(a.path);
      // asset paths may also be relative to the engine repoRoot — resolve for the upload.
      const localPath = path.isAbsolute(a.path) ? a.path : (scope.repoRoot ? path.join(scope.repoRoot, a.path) : a.path);
      return {
        kind: a.kind,
        source: a.source || null,
        fileName,
        localPath,
        storagePath: draftId ? `agencies/${agencyId}/brands/${brandId}/media/${draftId}/${fileName}` : null,
        aspect: a.aspect || null,
        cells: a.cells == null ? null : a.cells,
      };
    });

  const queueItem = {
    ...pick(item, QUEUE_FIELDS),
    agencyId, brandId, draftId,
    mediaCount: assets.length,
    archived: false,
  };

  let draftDoc = null;
  if (draft) {
    draftDoc = {
      ...pick(draft, DRAFT_FIELDS),
      agencyId, brandId,
      // client-safe asset refs (no localPath)
      assets: assets.map(({ localPath, ...rest }) => rest),
    };
  }

  return { queueId: item.queueId, draftId, queueItem, draft: draftDoc, assets };
}

/** Deterministic stringify (sorted keys) so the hash is stable across passes. */
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Content hash over the projection (excludes write-time fields like mirroredAt). */
export function contentHash(projection) {
  const basis = {
    q: projection.queueItem,
    d: projection.draft,
    a: projection.assets.map((a) => ({ k: a.kind, s: a.storagePath, f: a.fileName })),
  };
  return crypto.createHash("sha1").update(stableStringify(basis)).digest("hex");
}

/**
 * Decide upserts + archives. `prevHashes` is a Map(queueId -> hash) from the last
 * pass; each projection must carry `.hash`. Returns the changed projections to
 * upsert, the queueIds that vanished (to archive), and the seen set.
 */
export function planMirror(prevHashes, projections) {
  const upserts = [];
  const seen = new Set();
  for (const p of projections) {
    seen.add(p.queueId);
    if (prevHashes.get(p.queueId) !== p.hash) upserts.push(p);
  }
  const archives = [];
  for (const qid of prevHashes.keys()) if (!seen.has(qid)) archives.push(qid);
  return { upserts, archives, seen };
}

export const _internals = { stableStringify, pick, QUEUE_FIELDS, DRAFT_FIELDS };
