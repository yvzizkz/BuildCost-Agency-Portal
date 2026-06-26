import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function approve(
  agencyId: string,
  brandId: string,
  uid: string,
  queueId: string
): Promise<string> {
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
  if (!notes || notes.trim() === '') {
    throw new Error('Revision notes are required to reject a queue item.');
  }

  const commandsCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'commands');
  const commandDocRef = doc(commandsCol);

  const commandData = {
    type: 'reject',
    status: 'requested',
    requestedByUid: uid,
    queueId,
    notes: notes.trim(),
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
