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
  producer: 'social' | 'reel' | string
): Promise<string> {
  const commandsCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'commands');
  const commandDocRef = doc(commandsCol);

  const commandData = {
    type: 'requestGeneration',
    status: 'requested',
    requestedByUid: uid,
    payload: {
      producer,
    },
    createdAtMs: Date.now(),
  };

  await setDoc(commandDocRef, commandData);
  return commandDocRef.id;
}
