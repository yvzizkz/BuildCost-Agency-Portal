// scripts/seed.mjs — Phase-1 manual seed. Run ONCE with the portal-bridge Admin
// SA (Admin bypasses the rules that make users/agencies/brands write-only), AFTER
// the Firestore rules + SA exist and BEFORE the owners' first sign-in. Idempotent.
// Brand IDs MUST match the engine's brand.json slugs (the bridge maps brandId->slug 1:1).
//
//   GOOGLE_APPLICATION_CREDENTIALS=./portal-bridge-sa.json node scripts/seed.mjs
//
// NOTE: not run this session — included so Marco's portal track has the contract.
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore(), auth = admin.auth();

const AGENCY = "marco-agency";
const BRANDS = [
  { id: "saddlewood", displayName: "Saddlewood Contracting", status: "active" },
  { id: "isramar", displayName: "Isramar Construction", status: "active" },
];
const OWNERS = [
  { email: "marco@saddlewoodcontracting.com", role: "owner" }, // Marco
  { email: "ilene8a@gmail.com", role: "owner" },               // Ilene (set the real email before running)
];

async function uidFor(email) { // create if absent; they verify via magic-link on 1st login
  try { return (await auth.getUserByEmail(email)).uid; }
  catch { return (await auth.createUser({ email })).uid; }
}

await db.doc(`agencies/${AGENCY}`).set(
  { name: "Marco Agency", domain: `${AGENCY}.buildcost.info`,
    createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

for (const b of BRANDS)
  await db.doc(`agencies/${AGENCY}/brands/${b.id}`).set({ slug: b.id, ...b }, { merge: true });

const brandIds = BRANDS.map((b) => b.id), ownerUids = [];
for (const o of OWNERS) {
  const uid = await uidFor(o.email);
  ownerUids.push(uid);
  await db.doc(`users/${uid}`).set({ agencyId: AGENCY, role: o.role, brands: brandIds }, { merge: true });
  // optional custom-claims optimization (skips the per-rule users/ read):
  // await auth.setCustomUserClaims(uid, { agencyId: AGENCY, role: o.role, brands: brandIds });
}
await db.doc(`agencies/${AGENCY}`).set({ ownerUids }, { merge: true });
console.log("seeded", AGENCY, brandIds, ownerUids);
