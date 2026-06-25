import { collection, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { QueueItem, Draft } from './types';

export function subscribeToQueue(
  agencyId: string,
  brandId: string,
  onUpdate: (items: QueueItem[]) => void,
  onError: (err: any) => void
) {
  const q = query(
    collection(db, 'agencies', agencyId, 'brands', brandId, 'queueItems'),
    where('archived', '==', false),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const items: QueueItem[] = [];
    snapshot.forEach((doc) => {
      items.push({ queueId: doc.id, ...doc.data() } as QueueItem);
    });
    onUpdate(items);
  }, onError);
}

export async function fetchDraft(
  agencyId: string,
  brandId: string,
  draftId: string
): Promise<Draft | null> {
  const docRef = doc(db, 'agencies', agencyId, 'brands', brandId, 'drafts', draftId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { draftId: docSnap.id, ...docSnap.data() } as Draft;
  }
  return null;
}
