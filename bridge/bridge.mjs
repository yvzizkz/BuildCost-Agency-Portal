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

  // TODO (next track — NOT this session): a parallel collectionGroup('commands')
  // listener for approve / reject / requestGeneration, each dispatched to the
  // EXISTING engine CLI (approval_flow.py / producer skills) per Appendix A.
  // The spend path (meta_ads activate) is excluded from any whitelist.
}

/** Derive {agencyId, brandId} from the doc path: agencies/{a}/brands/{b}/submissions/{id}. */
function pathIds(ref) {
  const parts = ref.path.split("/");
  return { agencyId: parts[1], brandId: parts[3] };
}

listen();
