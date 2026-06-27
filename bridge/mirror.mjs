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

// --------------------------------------------------------------------------- //
// Phase 2/3 — triage.json + strategy.json read-projections (engine -> Firestore).
// Same discipline as projectItem: PURE, client-safe (media paths reduced to a
// basename — never leak the engine tree), and content-hashed so the worker only
// writes on real change. These feed the read-only `triageReports` / `strategies`
// collections the portal's triage-results + calendar UIs render; clients never write
// them (firestore.rules). Both are keyed by submissionId so a submission's triage +
// calendar are looked up by the same id the owner created.
// --------------------------------------------------------------------------- //
function baseName(p) { return path.basename(String(p || "")); }

// Intent fields surfaced from the triage brief (campaign/mediaRights stay internal).
const BRIEF_FIELDS = ["motivation", "suggestedMotivation", "objective", "channel", "offer",
  "mustSay", "businessType", "audienceNote"];

/** Project one triage.json into a client-safe triageReports doc; null if unusable. */
export function projectTriage(report, scope) {
  if (!report || typeof report !== "object") return null;
  const submissionId = report.submissionId;
  if (!submissionId) return null;
  const { agencyId, brandId } = scope;
  const brief = report.brief && typeof report.brief === "object" ? report.brief : {};
  const counts = { use: 0, enhance: 0, skip: 0 };
  const assets = (Array.isArray(report.assets) ? report.assets : []).map((a) => {
    const s = (a && a.scores) || {};
    const verdict = s.verdict || "use";
    if (counts[verdict] !== undefined) counts[verdict] += 1;
    return {
      file: baseName(a && a.file), kind: (a && a.kind) || "image",
      quality: s.quality ?? null, relevance: s.relevance ?? null,
      messaging: s.messaging ?? null, overall: s.overall ?? null,
      verdict, captionAngle: s.captionAngle || "", notes: s.notes || "",
      defects: Array.isArray(s.defects) ? s.defects : [],
      enhanced: a && a.enhanced ? baseName(a.enhanced) : null,
    };
  });
  const rb = report.recommendedBundle || {};
  const doc = {
    submissionId, agencyId, brandId, brand: report.brand || scope.slug || null,
    triagedAt: report.triagedAt || null,
    brief: pick(brief, BRIEF_FIELDS),
    research: report.research || null,
    template: report.template || null,
    assets,
    recommendedBundle: {
      routesReady: Array.isArray(rb.routesReady) ? rb.routesReady : [],
      routesPhase2: Array.isArray(rb.routesPhase2) ? rb.routesPhase2 : [],
      topAssets: (Array.isArray(rb.topAssets) ? rb.topAssets : []).map(baseName),
    },
    summary: { assetCount: assets.length, ...counts },
    humanGate: report.humanGate || null,
  };
  return { key: submissionId, scope: { agencyId, brandId }, doc };
}

const STRATEGY_FIELDS = ["strategyId", "submissionId", "plannedAt", "horizon", "horizonDays",
  "businessType", "motivation", "motivationLabel", "suggestedMotivation", "objective", "channel",
  "offer", "mustSay", "theme", "cadence", "channelMix", "pillars", "research", "routesReady",
  "routesPhase2", "summary", "enrichment", "humanGate"];
const SLOT_FIELDS = ["n", "date", "localDate", "dayOfWeek", "route", "routeStatus", "provider",
  "model", "kind", "aspect", "style", "needsSource", "creativeDirection", "channel", "pillar",
  "hook", "captionDirection", "status"];

/** Project one strategy.json into a client-safe strategies doc; null if unusable. */
export function projectStrategy(strategy, scope) {
  if (!strategy || typeof strategy !== "object") return null;
  const key = strategy.submissionId || strategy.strategyId;
  if (!key) return null;
  const { agencyId, brandId } = scope;
  const slots = (Array.isArray(strategy.slots) ? strategy.slots : []).map((s) => ({
    ...pick(s, SLOT_FIELDS),
    sourceAsset: s && s.sourceAsset ? baseName(s.sourceAsset) : null,
  }));
  const doc = {
    ...pick(strategy, STRATEGY_FIELDS),
    agencyId, brandId, brand: strategy.brand || scope.slug || null, slots,
  };
  return { key, scope: { agencyId, brandId }, doc };
}

/** Stable content hash over a projected doc (so the worker writes only on real change). */
export function docHash(doc) {
  return crypto.createHash("sha1").update(stableStringify(doc)).digest("hex");
}

export const _internals = { stableStringify, pick, QUEUE_FIELDS, DRAFT_FIELDS };
