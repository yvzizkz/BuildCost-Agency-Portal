import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { QueueItem, Draft, TriageReport, Strategy } from './types';

// createdAt arrives as one of three shapes (Firestore Timestamp | ISO string |
// epoch number); normalize to millis so we can sort newest-first in the client.
function createdAtMs(v: QueueItem['createdAt']): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; }
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v && typeof (v as { seconds?: number }).seconds === 'number') {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function subscribeToQueue(
  agencyId: string,
  brandId: string,
  onUpdate: (items: QueueItem[]) => void,
  onError: (err: unknown) => void
) {
  // Equality-only query → served by the automatic single-field index, so NO
  // composite index is required. (Pairing where('archived') with an
  // orderBy('createdAt') would require a composite index, and a missing one
  // surfaces to the owner as "Failed to load queue items".) We order
  // newest-first client-side instead — the per-brand review queue is small.
  const q = query(
    collection(db, 'agencies', agencyId, 'brands', brandId, 'queueItems'),
    where('archived', '==', false)
  );

  return onSnapshot(q, (snapshot) => {
    const items: QueueItem[] = [];
    snapshot.forEach((d) => {
      items.push({ queueId: d.id, ...d.data() } as QueueItem);
    });
    items.sort((a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
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

export function subscribeToTriageReports(
  agencyId: string,
  brandId: string,
  onUpdate: (reports: Record<string, TriageReport>) => void,
  onError: (err: unknown) => void
) {
  const q = collection(db, 'agencies', agencyId, 'brands', brandId, 'triageReports');

  return onSnapshot(
    q,
    (snapshot) => {
      const reports: Record<string, TriageReport> = {};
      snapshot.forEach((d) => {
        reports[d.id] = { submissionId: d.id, ...d.data() } as TriageReport;
      });
      onUpdate(reports);
    },
    onError
  );
}

export function subscribeToStrategies(
  agencyId: string,
  brandId: string,
  onUpdate: (strategies: Record<string, Strategy>) => void,
  onError: (err: unknown) => void
) {
  const q = collection(db, 'agencies', agencyId, 'brands', brandId, 'strategies');

  return onSnapshot(
    q,
    (snapshot) => {
      const strategies: Record<string, Strategy> = {};
      snapshot.forEach((d) => {
        strategies[d.id] = { strategyId: d.id, ...d.data() } as Strategy;
      });
      onUpdate(strategies);
    },
    onError
  );
}
