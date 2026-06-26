import { ref, uploadBytes } from 'firebase/storage';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, storage } from './firebase';

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
}

export async function uploadAndSubmit(
  agencyId: string,
  brandId: string,
  uid: string,
  input: SubmissionInput
): Promise<string> {
  const { title, neighborhood, note, files } = input;
  if (!files || files.length === 0) {
    throw new Error('At least one file is required for submission.');
  }

  const uploadPromises = files.map(async (file) => {
    if (file.size >= 25 * 1024 * 1024) {
      throw new Error(`File ${file.name} exceeds the 25MB limit.`);
    }
    if (!file.type.match(/^image\//) && !file.type.match(/^video\//)) {
      throw new Error(`File ${file.name} is not an image or video.`);
    }

    const uniqueFileName = `${Date.now()}_${sanitizeFileName(file.name)}`;
    const storagePath = `agencies/${agencyId}/brands/${brandId}/uploads/${uid}/${uniqueFileName}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file);
    return storagePath;
  });

  const storagePaths = await Promise.all(uploadPromises);

  const submissionCol = collection(db, 'agencies', agencyId, 'brands', brandId, 'submissions');
  const submissionDocRef = doc(submissionCol);

  const submissionData: any = {
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

  await setDoc(submissionDocRef, submissionData);

  return submissionDocRef.id;
}
