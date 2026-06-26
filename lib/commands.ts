import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// Client-side fail-fast validation. The bridge (bridge/dispatch.mjs) is the AUTHORITATIVE
// gate before anything reaches the engine; these mirror its patterns 1:1 so malformed input
// never even lands in Firestore. Keep these in sync with dispatch.mjs.
const QUEUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/; // e.g. saddlewood-2026-W26-post-1
const SLUG_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/; // engine project/slot slugs
const NOTES_MAX = 500;
// Mirrors dispatch.mjs SOCIAL_MEDIA exactly ('card' excluded — needs --card-text).
const SOCIAL_MEDIA = new Set([
  'single', 'vision', 'carousel',
  'collage:before-after', 'collage:grid-2x2', 'collage:process-journey',
  'collage:feature-trio', 'collage:reveal',
]);

/** Trim, strip control chars, collapse whitespace, cap length — matches dispatch.mjs cleanNotes. */
function cleanNotes(s: string): string {
  return String(s ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTES_MAX);
}

export async function approve(
  agencyId: string,
  brandId: string,
  uid: string,
  queueId: string
): Promise<string> {
  if (!QUEUE_ID_RE.test(queueId)) {
    throw new Error('Invalid queueId.');
  }

  const commandsCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'commands');
  const commandDocRef = doc(commandsCol);

  const commandData = {
    type: 'approve',
    status: 'requested',
    requestedByUid: uid,
    queueId,
    createdAtMs: Date.now(),
  };

  await setDoc(commandDocRef, commandData);
  return commandDocRef.id;
}

export async function reject(
  agencyId: string,
  brandId: string,
  uid: string,
  queueId: string,
  notes: string
): Promise<string> {
  if (!QUEUE_ID_RE.test(queueId)) {
    throw new Error('Invalid queueId.');
  }
  if (!notes || notes.trim() === '') {
    throw new Error('Revision notes are required to reject a queue item.');
  }
  const cleanedNotes = cleanNotes(notes);
  if (!cleanedNotes) {
    throw new Error('Revision notes are required to reject a queue item.');
  }

  const commandsCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'commands');
  const commandDocRef = doc(commandsCol);

  const commandData = {
    type: 'reject',
    status: 'requested',
    requestedByUid: uid,
    queueId,
    notes: cleanedNotes,
    createdAtMs: Date.now(),
  };

  await setDoc(commandDocRef, commandData);
  return commandDocRef.id;
}

export async function requestGeneration(
  agencyId: string,
  brandId: string,
  uid: string,
  producer: 'social' | 'reel' | string,
  opts?: { project?: string; media?: string }
): Promise<string> {
  if (producer !== 'social' && producer !== 'reel') {
    throw new Error(`Invalid producer: ${producer}`);
  }
  if (opts?.project && !SLUG_ID_RE.test(opts.project)) {
    throw new Error('Invalid project id.');
  }
  if (opts?.media && !SOCIAL_MEDIA.has(opts.media)) {
    throw new Error(`Invalid media: ${opts.media}`);
  }

  const commandsCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'commands');
  const commandDocRef = doc(commandsCol);

  // Only include project/media when set, so the untargeted "Generate Social Post" path is
  // unchanged. The bridge validates both against the studio vocabulary before invoking.
  const payload: { producer: string; project?: string; media?: string } = { producer };
  if (opts?.project) payload.project = opts.project;
  if (opts?.media) payload.media = opts.media;

  const commandData = {
    type: 'requestGeneration',
    status: 'requested',
    requestedByUid: uid,
    payload,
    createdAtMs: Date.now(),
  };

  await setDoc(commandDocRef, commandData);
  return commandDocRef.id;
}
