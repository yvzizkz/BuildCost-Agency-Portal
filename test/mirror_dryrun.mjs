/**
 * mirror_dryrun.mjs — read-only Loop-1 dry run against a real engine repo.
 * Projects the live review-queue + draft files and prints what WOULD be mirrored
 * to Firestore (no Firebase, no writes). Verifies the projection handles every
 * real item shape. Run: node test/mirror_dryrun.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrand, resolveDraftPath, projectItem, contentHash, planMirror } from "../bridge/mirror.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANTS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "bridge", "tenants.json"), "utf8"));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

const projections = [];
let skipped = 0;
for (const [agencyId, a] of Object.entries(TENANTS)) {
  if (agencyId.startsWith("_") || !a?.repoRoot) continue;
  const qPath = path.join(a.repoRoot, "growth-assets", "review-queue.json");
  const q = readJson(qPath);
  const items = q?.items || [];
  console.log(`\n== ${agencyId}: ${items.length} queue items @ ${qPath} ==`);
  for (const item of items) {
    const brand = resolveBrand(TENANTS, item.business);
    if (!brand) { skipped++; continue; }
    const dp = resolveDraftPath(a.repoRoot, item.link);
    const draft = (dp && fs.existsSync(dp)) ? readJson(dp) : null;
    const p = projectItem(item, draft, brand);
    p.hash = contentHash(p);
    projections.push(p);
    const media = p.assets.map((as) => (fs.existsSync(as.localPath) ? "✓" : "✗") + as.kind).join(",") || "-";
    console.log(
      `  ${item.business.padEnd(10)} ${String(item.type).padEnd(17)} ${String(item.status).padEnd(16)} ` +
      `draft:${p.draftId ? "yes" : "no "} media:${String(p.queueItem.mediaCount)} [${media}] ${item.queueId}`);
  }
}

const { upserts, archives } = planMirror(new Map(), projections);
const missingMedia = projections.flatMap((p) => p.assets).filter((a) => !fs.existsSync(a.localPath));
console.log(`\nfirst-pass plan: ${upserts.length} upserts, ${archives.length} archives, ` +
  `${projections.length} live projections, ${skipped} skipped (unmapped slug)`);
console.log(`media: ${projections.reduce((n, p) => n + p.assets.length, 0)} asset refs, ` +
  `${missingMedia.length} missing on disk (would be skipped on upload)`);
console.log(missingMedia.length || skipped ? "note: missing media/skips are tolerated, not errors." : "all assets present.");
