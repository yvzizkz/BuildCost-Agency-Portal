import { ref, uploadBytesResumable } from 'firebase/storage';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, storage } from './firebase';
import { IntentBrief } from './types';

// Max single-file upload. Raised from 25MB so phone videos / reels go through.
// The Storage rule enforces the same ceiling; resumable uploads (below) make large
// transfers reliable on flaky connections. Files bigger than this should use the
// Drive/Dropbox link path (separate feature).
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// Storage object keys are built from the client-supplied File.name. A crafted name
// (e.g. "../../other-uid/x.jpg" or one with control chars / "#" / "?") could produce
// an escaping or malformed key, so we drop any path components and allow only a safe
// charset before interpolating it into the storage path. Defense-in-depth: the Storage
// rules still scope writes to uploads/{uid}/, this just keeps keys clean and predictable.
function sanitizeFileName(name: string): string {
  const base = (name || '').split(/[\\/]/).pop() || 'file';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_') // only alphanumerics, dot, underscore, hyphen
    .replace(/^\.+/, ''); // no leading dots -> kills "." / ".." path segments
  return cleaned.slice(0, 128) || 'file';
}

export interface SubmissionInput {
  title: string;
  neighborhood?: string;
  note?: string;
  files: File[];
  heroIndex: number;
  processIndexes: number[];
  brief?: IntentBrief;
}

interface SubmissionData {
  uploaderUid: string;
  status: 'requested';
  title: string;
  storagePaths: string[];
  createdAtMs: number;
  neighborhood?: string;
  note?: string;
  heroStoragePath?: string;
  processStoragePaths?: string[];
  brief?: IntentBrief;
}

export async function uploadAndSubmit(
  agencyId: string,
  brandId: string,
  uid: string,
  input: SubmissionInput,
  onProgress?: (percent: number) => void
): Promise<string> {
  const { title, neighborhood, note, files } = input;
  if (!files || files.length === 0) {
    throw new Error('At least one file is required for submission.');
  }

  // Aggregate progress across all files so the UI can show a single bar.
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
  const transferred = new Array(files.length).fill(0);
  const emitProgress = () => {
    if (!onProgress) return;
    const moved = transferred.reduce((a, b) => a + b, 0);
    onProgress(Math.min(100, Math.round((moved / totalBytes) * 100)));
  };

  const uploadOne = (file: File, index: number): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        reject(new Error(`"${file.name}" is larger than the 2 GB limit.`));
        return;
      }
      if (!file.type.match(/^image\//) && !file.type.match(/^video\//)) {
        reject(new Error(`"${file.name}" is not an image or video.`));
        return;
      }

      const uniqueFileName = `${Date.now()}_${sanitizeFileName(file.name)}`;
      const storagePath = `agencies/${agencyId}/brands/${brandId}/uploads/${uid}/${uniqueFileName}`;
      const task = uploadBytesResumable(ref(storage, storagePath), file, {
        contentType: file.type,
      });
      task.on(
        'state_changed',
        (snap) => {
          transferred[index] = snap.bytesTransferred;
          emitProgress();
        },
        (err) => reject(err),
        () => {
          transferred[index] = file.size;
          emitProgress();
          resolve(storagePath);
        }
      );
    });

  const storagePaths = await Promise.all(files.map(uploadOne));

  const submissionCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'submissions');
  const submissionDocRef = doc(submissionCol);

  const submissionData: SubmissionData = {
    uploaderUid: uid,
    status: 'requested',
    title,
    storagePaths,
    createdAtMs: Date.now(),
  };

  if (neighborhood) submissionData.neighborhood = neighborhood;
  if (note) submissionData.note = note;

  const finalHeroIndex = (input.heroIndex !== undefined && input.heroIndex >= 0 && input.heroIndex < storagePaths.length)
    ? input.heroIndex
    : 0;

  if (storagePaths.length > 0) {
    submissionData.heroStoragePath = storagePaths[finalHeroIndex];
  }

  const processPaths: string[] = [];
  if (input.processIndexes) {
    const seenPaths = new Set<string>();
    for (const idx of input.processIndexes) {
      if (idx >= 0 && idx < storagePaths.length && idx !== finalHeroIndex) {
        const path = storagePaths[idx];
        if (!seenPaths.has(path)) {
          processPaths.push(path);
          seenPaths.add(path);
        }
      }
    }
  }

  if (processPaths.length > 0) {
    submissionData.processStoragePaths = processPaths;
  }

  if (input.brief) {
    submissionData.brief = input.brief;
  }

  await setDoc(submissionDocRef, submissionData);

  return submissionDocRef.id;
}
