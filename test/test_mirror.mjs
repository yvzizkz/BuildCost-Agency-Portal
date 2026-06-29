/**
 * test_mirror.mjs — unit tests for bridge/mirror.mjs (Loop 1 projection logic).
 * Pure: no Firebase, no filesystem, no engine. Run: node --test test/test_mirror.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBrand, isDraftLink, resolveDraftPath, projectItem, contentHash, planMirror, projectMetrics, docHash } from "../bridge/mirror.mjs";

const TENANTS = {
  _comment: "ignore me",
  "marco-agency": {
    repoRoot: "/repo", env: "/repo/.env",
    brands: { saddlewood: "saddlewood", isramar: "isramar" },
  },
};
const SCOPE = { agencyId: "marco-agency", brandId: "saddlewood" };

const socialItem = {
  queueId: "saddlewood-2026-W26-post-1", business: "saddlewood", type: "social-post",
  summary: "Before/After showcase", action: "Review & approve", status: "pending",
  link: "/repo/growth-assets/drafts/saddlewood/saddlewood-2026-W26-post-1.json",
  estMinutes: 2, createdAt: "2026-06-23T10:39:57Z", publishCommand: null,
};
const socialDraft = {
  draftId: "saddlewood-2026-W26-post-1", brand: "saddlewood", type: "social-post",
  pillar: "Before/After", media: "collage:process-journey", groundedProject: "paradise-valley-whole-home",
  copy: { body: "…", hashtags: ["#a"], cta: "Call" }, voiceCheck: { passed: true, violations: [] },
  status: "drafted", createdAt: "2026-06-23T10:39:57Z",
  assets: [{ kind: "image", path: "/repo/growth-assets/generated/saddlewood/saddlewood-2026-W26-post-1.jpg", source: "collage:process-journey", cells: 6 }],
};

// ---- resolveBrand -----------------------------------------------------------
test("resolveBrand maps a slug to its agency/brand and ignores _comment", () => {
  assert.deepEqual(resolveBrand(TENANTS, "saddlewood"),
    { agencyId: "marco-agency", brandId: "saddlewood", repoRoot: "/repo", env: "/repo/.env", slug: "saddlewood" });
  assert.equal(resolveBrand(TENANTS, "isramar").brandId, "isramar");
  assert.equal(resolveBrand(TENANTS, "nope"), null);
});

// ---- isDraftLink ------------------------------------------------------------
test("isDraftLink accepts draft json, rejects projects.json / none", () => {
  assert.equal(isDraftLink("/repo/growth-assets/drafts/saddlewood/x.json"), true);
  assert.equal(isDraftLink("/repo/brands/saddlewood/reference/projects.json"), false);
  assert.equal(isDraftLink("/repo/growth-assets/drafts/saddlewood/projects.json"), false);
  assert.equal(isDraftLink(null), false);
  assert.equal(isDraftLink("/repo/drafts/x.txt"), false);
});

// ---- resolveDraftPath -------------------------------------------------------
test("resolveDraftPath resolves relative links against repoRoot, keeps absolute", () => {
  assert.equal(resolveDraftPath("/repo", "/abs/growth-assets/drafts/s/x.json"), "/abs/growth-assets/drafts/s/x.json");
  assert.equal(resolveDraftPath("/repo", "growth-assets/drafts/s/x.json"), "/repo/growth-assets/drafts/s/x.json");
  assert.equal(resolveDraftPath("/repo", "/repo/brands/s/reference/projects.json"), null); // not a draft
  assert.equal(resolveDraftPath("/repo", null), null);
});

test("projectItem resolves a relative asset path against repoRoot for upload", () => {
  const draft = { draftId: "d1", brand: "saddlewood", type: "social-post", copy: {},
    assets: [{ kind: "image", path: "growth-assets/generated/saddlewood/d1.jpg" }] };
  const p = projectItem(socialItem, draft, { ...SCOPE, repoRoot: "/repo" });
  assert.equal(p.assets[0].localPath, "/repo/growth-assets/generated/saddlewood/d1.jpg");
  assert.equal(p.assets[0].storagePath, "agencies/marco-agency/brands/saddlewood/media/d1/d1.jpg");
});

// ---- projectItem ------------------------------------------------------------
test("projectItem(social) builds queueItem + draft + asset with storagePath", () => {
  const p = projectItem(socialItem, socialDraft, SCOPE);
  assert.equal(p.queueId, "saddlewood-2026-W26-post-1");
  assert.equal(p.queueItem.agencyId, "marco-agency");
  assert.equal(p.queueItem.brandId, "saddlewood");
  assert.equal(p.queueItem.draftId, "saddlewood-2026-W26-post-1");
  assert.equal(p.queueItem.mediaCount, 1);
  assert.equal(p.queueItem.archived, false);
  // asset for upload keeps localPath; storagePath under media/<draftId>/<file>
  assert.equal(p.assets[0].localPath, socialDraft.assets[0].path);
  assert.equal(p.assets[0].storagePath,
    "agencies/marco-agency/brands/saddlewood/media/saddlewood-2026-W26-post-1/saddlewood-2026-W26-post-1.jpg");
  // draft doc's asset refs must NOT leak the absolute local path
  assert.equal(p.draft.assets[0].localPath, undefined);
  assert.equal(p.draft.assets[0].storagePath, p.assets[0].storagePath);
  assert.deepEqual(p.draft.copy, socialDraft.copy);
});

test("projectItem(reel) carries mediaQA and a video asset", () => {
  const reelDraft = {
    draftId: "saddlewood-2026-W26-reel", brand: "saddlewood", type: "reel",
    copy: { body: "x" }, voiceCheck: { passed: true, violations: [] },
    mediaQA: { verdict: "pass", score: 9, defects: [] }, status: "drafted", createdAt: "t",
    assets: [{ kind: "video", path: "/repo/growth-assets/generated/saddlewood/r.mp4", source: "veo-reel", aspect: "9:16" }],
  };
  const p = projectItem({ ...socialItem, type: "reel", draftId: undefined }, reelDraft, SCOPE);
  assert.equal(p.draft.mediaQA.verdict, "pass");
  assert.equal(p.assets[0].kind, "video");
  assert.equal(p.assets[0].aspect, "9:16");
});

test("projectItem(neighborhood-page) has a draft but no assets", () => {
  const npDraft = { draftId: "saddlewood-neighborhood-silverleaf", brand: "saddlewood",
    type: "neighborhood-page", neighborhood: "Silverleaf",
    copy: { tagline: "t", description: "d" }, voiceCheck: { passed: true }, status: "pending", createdAt: "t" };
  const p = projectItem({ ...socialItem, type: "neighborhood-page" }, npDraft, SCOPE);
  assert.equal(p.queueItem.mediaCount, 0);
  assert.deepEqual(p.draft.assets, []);
  assert.equal(p.draft.neighborhood, "Silverleaf");
});

test("projectItem(intake, no draft) projects the queue item only", () => {
  const intakeItem = { queueId: "saddlewood-portal-sub1", business: "saddlewood", type: "intake",
    summary: "[intake] …", status: "pending", projectId: "arcadia-kitchen", source: "portal-intake",
    link: "/repo/brands/saddlewood/reference/projects.json", createdAt: "t" };
  const p = projectItem(intakeItem, null, SCOPE);   // bridge passes null for non-draft links
  assert.equal(p.draft, null);
  assert.deepEqual(p.assets, []);
  assert.equal(p.queueItem.mediaCount, 0);
  assert.equal(p.queueItem.projectId, "arcadia-kitchen");
  assert.equal(p.queueItem.source, "portal-intake");
});

// ---- contentHash ------------------------------------------------------------
test("contentHash is stable and reflects status changes", () => {
  const a = projectItem(socialItem, socialDraft, SCOPE);
  const b = projectItem(socialItem, socialDraft, SCOPE);
  assert.equal(contentHash(a), contentHash(b));
  const changed = projectItem({ ...socialItem, status: "approved", approvedAt: "later" }, socialDraft, SCOPE);
  assert.notEqual(contentHash(a), contentHash(changed));
});

// ---- planMirror -------------------------------------------------------------
function withHash(p) { return { ...p, hash: contentHash(p) }; }

test("planMirror: first pass upserts all, steady state is a no-op", () => {
  const p = withHash(projectItem(socialItem, socialDraft, SCOPE));
  const first = planMirror(new Map(), [p]);
  assert.equal(first.upserts.length, 1);
  assert.equal(first.archives.length, 0);

  const prev = new Map([[p.queueId, p.hash]]);
  const second = planMirror(prev, [p]);
  assert.equal(second.upserts.length, 0);
  assert.equal(second.archives.length, 0);
});

test("planMirror: a changed item re-upserts; a vanished item is archived", () => {
  const p = withHash(projectItem(socialItem, socialDraft, SCOPE));
  const prev = new Map([[p.queueId, p.hash], ["gone-1", "oldhash"]]);

  const changed = withHash(projectItem({ ...socialItem, status: "approved" }, socialDraft, SCOPE));
  const { upserts, archives } = planMirror(prev, [changed]);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].queueId, "saddlewood-2026-W26-post-1");
  assert.deepEqual(archives, ["gone-1"]);
});

// ---- projectMetrics ---------------------------------------------------------
const metricsSummary = {
  schemaVersion: 1, brand: "saddlewood", displayName: "Saddlewood Contracting",
  generatedAt: "2026-06-29T18:43:55Z",
  blocks: {
    funnel: { status: "live", contacts: 655, opportunities: 13, won: 0 },
    seo: { status: "live", impressions: 13, avgPosition: 2.4,
      topQueries: [{ query: "waterproofing basement", position: 1, impressions: 12, clicks: 0 }] },
    engagement: { status: "empty", hasData: false, note: "no engagement yet" },
    spend: { status: "live", month: "2026-06", spentUsd: 8.27 },
    reviews: { status: "pending-producer", source: null },
    gbp: { status: "pending-producer", source: null },
    paid: { status: "disabled", source: null },
  },
};

test("projectMetrics: well-known 'summary' docId, brand-scoped hash key, no path leak", () => {
  const p = projectMetrics(metricsSummary, SCOPE);
  assert.equal(p.docId, "summary");                              // clean Firestore doc id
  assert.equal(p.key, "marco-agency/saddlewood/summary");        // globally-unique hash key
  assert.equal(p.scope.agencyId, "marco-agency");
  assert.equal(p.scope.brandId, "saddlewood");
  assert.equal(p.doc.agencyId, "marco-agency");
  assert.equal(p.doc.brandId, "saddlewood");
  assert.equal(p.doc.schemaVersion, 1);
  assert.equal(p.doc.blocks.funnel.contacts, 655);
  assert.equal(p.doc.blocks.seo.topQueries[0].position, 1);
  assert.equal(p.doc.blocks.engagement.status, "empty");
  assert.equal(p.doc.blocks.paid.status, "disabled");
});

test("projectMetrics: two brands get distinct hash keys but share the 'summary' doc id", () => {
  const a = projectMetrics(metricsSummary, { agencyId: "marco-agency", brandId: "saddlewood" });
  const b = projectMetrics({ ...metricsSummary, brand: "isramar" }, { agencyId: "marco-agency", brandId: "isramar" });
  assert.notEqual(a.key, b.key);                                 // no collision in the global metricsHashes map
  assert.equal(a.docId, b.docId);                                // each writes its own brand's metrics/summary
});

test("projectMetrics: docHash is stable and reflects a value change; null on unusable input", () => {
  const a = projectMetrics(metricsSummary, SCOPE);
  const b = projectMetrics(metricsSummary, SCOPE);
  assert.equal(docHash(a.doc), docHash(b.doc));
  const changed = projectMetrics(
    { ...metricsSummary, blocks: { ...metricsSummary.blocks, funnel: { status: "live", contacts: 700 } } }, SCOPE);
  assert.notEqual(docHash(a.doc), docHash(changed.doc));
  assert.equal(projectMetrics(null, SCOPE), null);
  assert.equal(projectMetrics({ brand: "x" }, SCOPE), null);     // no blocks -> unusable
});
