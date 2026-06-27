/**
 * bridge.mjs — the agency-portal bridge worker (INTAKE path).
 *
 * The ONLY coupling between the Firebase portal and the Enterprise engine. It is
 * the sole writer of authoritative Firestore state (Admin SDK bypasses the
 * security rules) and the only process that touches the local engine.
 *
 * This file handles ALL Firebase I/O; it shells out to bridge/portal_intake.py
 * (the only engine-touching file) for the actual reference-library writes — a
 * clean split: Node ⇄ Firebase, Python ⇄ engine (via brandlib).
 *
 * SCOPE (this session): the INTAKE submission path — owner uploads photos, the
 * worker mirrors them into brands/<slug>/reference/ via portal_intake.py. The
 * approve / reject / requestGeneration command dispatch (Appendix A of
 * PLAN-agency-owner-portal.md) is the NEXT track and is intentionally stubbed
 * below with TODOs — it must call the existing engine CLIs, never new logic.
 *
 * Run (only once a real Firebase project + service account exist):
 *   GOOGLE_APPLICATION_CREDENTIALS=./portal-bridge-sa.json node bridge/bridge.mjs
 *
 * Safety invariants this worker preserves:
 *   - intake has NO send/publish/spend path (it only adds reference material).
 *   - strict tenant scoping: a submission's brand must map to a slug in its
 *     agency's tenant entry, else it is rejected (no cross-tenant execution).
 *   - no shell interpolation: execFile with an argv array, never shell:true.
 *   - single instance, serial per brand; idempotent transactional claim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { buildDispatch, cleanEditCopy } from "./dispatch.mjs";
import { resolveBrand, resolveDraftPath, projectItem, contentHash, planMirror } from "./mirror.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANTS = JSON.parse(fs.readFileSync(path.join(__dirname, "tenants.json"), "utf8"));
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
const EXEC_TIMEOUT_MS = 120_000;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: process.env.PORTAL_STORAGE_BUCKET, // e.g. <project>.appspot.com
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

/** Resolve (agencyId, brandId) -> engine config from the tenant map; null if unknown. */
function resolveTenant(agencyId, brandId) {
  const agency = TENANTS[agencyId];
  if (!agency) return null;
  const slug = agency.brands?.[brandId];
  if (!slug) return null;
  return { repoRoot: agency.repoRoot, env: agency.env, slug };
}

function sanitizeName(name) {
  return path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Run portal_intake.py with an argv array (no shell). Resolves with {code, stdout, stderr}. */
function runIntake(tenant, submissionPath, imagesDir, defaultCity) {
  const script = path.join(__dirname, "portal_intake.py");
  const argv = [
    script,
    "--slug", tenant.slug,
    "--submission", submissionPath,
    "--images-dir", imagesDir,
    "--engine-root", tenant.repoRoot,
    "--default-city", defaultCity || "",
    "--json",
  ];
  return new Promise((resolve) => {
    execFile("python3", argv, { cwd: tenant.repoRoot, timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, killed: err?.killed ?? false, stdout, stderr }));
  });
}

/** Run an engine invocation built by dispatch.mjs (argv array, no shell). */
function runExec(exec) {
  return new Promise((resolve) => {
    execFile(exec.file, exec.argv, { cwd: exec.cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, killed: err?.killed ?? false, stdout, stderr }));
  });
}

/**
 * Claim a 'requested' submission in a transaction so exactly one worker processes
 * it (idempotent, exactly-once). Returns the claimed data, or null if lost the race.
 */
async function claim(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.status !== "requested") return null;
    tx.update(ref, { status: "processing", claimedAt: admin.firestore.FieldValue.serverTimestamp() });
    return d;
  });
}

async function processSubmission(ref, data) {
  const { agencyId, brandId } = data;
  const tenant = resolveTenant(agencyId, brandId);
  if (!tenant) {
    await ref.update({ status: "error", error: `unknown tenant ${agencyId}/${brandId}` });
    return;
  }

  // Download the owner's photos from Storage to a temp dir; build the images[] list.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `portal-intake-${ref.id}-`));
  try {
    const storagePaths = Array.isArray(data.storagePaths) ? data.storagePaths : [];
    const heroPath = data.heroStoragePath || storagePaths[0];
    const processSet = new Set(Array.isArray(data.processStoragePaths) ? data.processStoragePaths : []);

    const images = [];
    let heroIndex = 0;
    for (let i = 0; i < storagePaths.length; i++) {
      const sp = storagePaths[i];
      const ext = path.extname(sp).toLowerCase();
      if (!ALLOWED_IMAGE_EXTS.has(ext)) continue; // images only for reference projects
      const local = path.join(tmpDir, `${i}-${sanitizeName(path.basename(sp))}`);
      await bucket.file(sp).download({ destination: local });
      if (sp === heroPath) heroIndex = images.length;
      images.push({ file: path.basename(local), process: processSet.has(sp) });
    }
    if (!images.length) {
      await ref.update({ status: "error", error: "no image files in submission" });
      return;
    }

    const submission = {
      submissionId: ref.id,
      slug: tenant.slug,
      title: String(data.title || "").trim(),
      neighborhood: String(data.neighborhood || "").trim(),
      story: String(data.note || data.story || "").trim(),
      submittedAt: data.submittedAt || new Date(data.createdAtMs || 0).toISOString(),
      heroIndex,
      images,
      // enrich-later structured fields (empty in the dead-simple model)
      scope: Array.isArray(data.scope) ? data.scope : [],
      materials: Array.isArray(data.materials) ? data.materials : [],
      signatureDetails: Array.isArray(data.signatureDetails) ? data.signatureDetails : [],
      heroDetail: String(data.heroDetail || "").trim(),
    };
    const submissionPath = path.join(tmpDir, "submission.json");
    fs.writeFileSync(submissionPath, JSON.stringify(submission));

    const r = await runIntake(tenant, submissionPath, tmpDir, data.defaultCity || "");
    let parsed = null;
    try { parsed = JSON.parse((r.stdout || "").trim().split("\n").pop()); } catch { /* leave null */ }

    if (r.code === 0 && parsed?.ok) {
      await ref.update({
        status: "done",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: parsed,
      });
      console.log(`[intake] ${tenant.slug}/${ref.id} -> ${parsed.status} (${parsed.projectId || "-"})`);
    } else {
      const msg = parsed?.error || (r.stderr || "").slice(-800) || `exit ${r.code}${r.killed ? " (timeout)" : ""}`;
      await ref.update({ status: "error", error: msg });
      console.error(`[intake] ${tenant.slug}/${ref.id} FAILED: ${msg}`);
    }
  } catch (e) {
    await ref.update({ status: "error", error: String(e?.message || e) });
    console.error(`[intake] ${ref.id} threw:`, e);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Process one owner command (approve / reject / requestGeneration). The dispatch
 * decision (allow-list, validation, sanitization, argv template, spend-path
 * exclusion) lives in dispatch.mjs; this only resolves the tenant, runs the argv,
 * and records the outcome. The owner client NEVER writes queueItems/drafts — the
 * engine CLIs do, under their own file locks; results mirror back via Loop 1.
 */
async function processCommand(ref, data) {
  const { agencyId, brandId } = data;
  const tenant = resolveTenant(agencyId, brandId);
  if (!tenant) {
    await ref.update({ status: "error", error: `unknown tenant ${agencyId}/${brandId}` });
    return;
  }
  // editCaption carries freeform owner copy. dispatch.mjs is pure (no fs), so we
  // re-validate the copy at the boundary and write the cleaned {body,hashtags[],cta}
  // to a temp JSON file, threading only its path into the argv. Cleaned up in finally.
  let copyFile = null;
  let payload = data.payload || data;
  if (data.type === "editCaption") {
    const cleaned = cleanEditCopy(data.copy);
    if (!cleaned) {
      await ref.update({ status: "error", error: "editCaption: empty caption" });
      return;
    }
    copyFile = path.join(os.tmpdir(), `portal-editcopy-${ref.id}.json`);
    fs.writeFileSync(copyFile, JSON.stringify(cleaned));
    payload = { queueId: data.queueId, copyFile };
  }

  try {
    const built = buildDispatch(tenant, data.type, payload);
    if (!built.ok) {
      await ref.update({ status: "error", error: built.error });
      console.warn(`[cmd] ${tenant.slug}/${ref.id} rejected: ${built.error}`);
      return;
    }
    const r = await runExec(built.exec);
    if (r.code === 0) {
      const result = built.exec.parse(r.stdout);
      await ref.update({
        status: "done",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        result,
      });
      console.log(`[cmd] ${built.exec.label} -> done`);
    } else {
      const msg = (r.stderr || "").slice(-800) || `exit ${r.code}${r.killed ? " (timeout)" : ""}`;
      await ref.update({ status: "error", error: msg });
      console.error(`[cmd] ${built.exec.label} FAILED: ${msg}`);
    }
  } finally {
    if (copyFile) { try { fs.unlinkSync(copyFile); } catch { /* ignore */ } }
  }
}

// --------------------------------------------------------------------------- //
// Loop 1 — Mirror (engine -> Firestore): the portal's read view.
// Watches each agency's review-queue.json, projects every item + its draft into
// queueItems/drafts (via mirror.mjs), pushes media to Storage, and only writes on
// a content-hash change. Items that leave the queue are archived (not deleted).
// --------------------------------------------------------------------------- //
const mirrorHashes = new Map();          // queueId -> last hash
let mirrorMeta = new Map();              // queueId -> { agencyId, brandId }
let mirrorRunning = false;
let mirrorPending = false;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function agencyRepos() {
  return Object.entries(TENANTS)
    .filter(([id, a]) => !id.startsWith("_") && a && a.repoRoot)
    .map(([agencyId, a]) => ({ agencyId, repoRoot: a.repoRoot,
      queuePath: path.join(a.repoRoot, "growth-assets", "review-queue.json") }));
}

async function runMirror() {
  if (mirrorRunning) { mirrorPending = true; return; }
  mirrorRunning = true;
  try {
    const projections = [];
    for (const repo of agencyRepos()) {
      const q = readJson(repo.queuePath);
      const items = (q && Array.isArray(q.items)) ? q.items : [];
      for (const item of items) {
        const brand = resolveBrand(TENANTS, item.business);
        if (!brand) continue;                                   // skip unknown slugs
        const dp = resolveDraftPath(repo.repoRoot, item.link);
        const draft = (dp && fs.existsSync(dp)) ? readJson(dp) : null;
        const p = projectItem(item, draft, brand);
        p.hash = contentHash(p);
        projections.push(p);
      }
    }

    const prevMeta = mirrorMeta;
    const { upserts, archives } = planMirror(mirrorHashes, projections);

    for (const p of upserts) {
      const { agencyId, brandId } = p.queueItem;
      // push media to Storage (only files that exist on disk)
      for (const a of p.assets) {
        if (a.storagePath && a.localPath && fs.existsSync(a.localPath)) {
          await bucket.upload(a.localPath, { destination: a.storagePath, resumable: false });
        }
      }
      const brandRef = db.doc(`agencies/${agencyId}/brands/${brandId}`);
      await brandRef.collection("queueItems").doc(p.queueId).set(
        { ...p.queueItem, contentHash: p.hash, mirroredAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true });
      if (p.draft && p.draftId) {
        await brandRef.collection("drafts").doc(p.draftId).set(
          { ...p.draft, mirroredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    for (const qid of archives) {
      const meta = prevMeta.get(qid);
      if (!meta) continue;
      await db.doc(`agencies/${meta.agencyId}/brands/${meta.brandId}`)
        .collection("queueItems").doc(qid)
        .set({ archived: true, archivedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // roll forward the in-memory state to exactly what's in the queue now
    mirrorHashes.clear();
    const nextMeta = new Map();
    for (const p of projections) {
      mirrorHashes.set(p.queueId, p.hash);
      nextMeta.set(p.queueId, { agencyId: p.queueItem.agencyId, brandId: p.queueItem.brandId });
    }
    mirrorMeta = nextMeta;

    if (upserts.length || archives.length) {
      console.log(`[mirror] ${upserts.length} upserted, ${archives.length} archived, ${projections.length} live`);
    }
  } catch (e) {
    console.error("[mirror] pass failed:", e?.message || e);
  } finally {
    mirrorRunning = false;
    if (mirrorPending) { mirrorPending = false; setTimeout(runMirror, 250); }
  }
}

/** Initial mirror + watch each growth-assets dir (debounced) + a poll safety net. */
function startMirror() {
  console.log("portal bridge: mirroring review-queue -> Firestore…");
  runMirror();
  let timer = null;
  const kick = () => { clearTimeout(timer); timer = setTimeout(runMirror, 1500); };
  for (const repo of agencyRepos()) {
    const dir = path.dirname(repo.queuePath);
    try {
      // watch the DIR (atomic os.replace swaps the inode, so watching the file alone misses updates)
      fs.watch(dir, (_evt, fname) => { if (!fname || fname === "review-queue.json") kick(); });
    } catch (e) {
      console.warn(`[mirror] cannot watch ${dir} (${e?.message}); relying on poll`);
    }
  }
  setInterval(runMirror, 60_000); // safety net for missed fs events
}

/**
 * Loop 2 (Firestore -> engine): listen for owner intake submissions.
 * Client creates  .../submissions/{id}  with status:"requested" (rules enforce
 * shape + scope); the worker is the only thing that transitions it.
 */
function listen() {
  console.log("portal bridge: listening for intake submissions (status==requested)…");
  db.collectionGroup("submissions")
    .where("status", "==", "requested")
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach(async (chg) => {
          if (chg.type !== "added") return;
          const ref = chg.doc.ref;
          const data = await claim(ref);
          if (data) await processSubmission(ref, { ...data, ...pathIds(ref) });
        });
      },
      (err) => console.error("submissions listener error:", err),
    );

  // Loop 2 (commands): approve / reject / requestGeneration, each dispatched to
  // an EXISTING engine CLI via dispatch.mjs. The spend path (meta_ads activate)
  // is structurally absent from every template.
  db.collectionGroup("commands")
    .where("status", "==", "requested")
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach(async (chg) => {
          if (chg.type !== "added") return;
          const ref = chg.doc.ref;
          const data = await claim(ref);
          if (data) await processCommand(ref, { ...data, ...pathIds(ref) });
        });
      },
      (err) => console.error("commands listener error:", err),
    );
}

/** Derive {agencyId, brandId} from the doc path: agencies/{a}/brands/{b}/submissions/{id}. */
function pathIds(ref) {
  const parts = ref.path.split("/");
  return { agencyId: parts[1], brandId: parts[3] };
}

startMirror();   // Loop 1: engine -> Firestore (read view)
listen();        // Loop 2: Firestore -> engine (submissions + commands)
