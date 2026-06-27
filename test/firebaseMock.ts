import { vi } from 'vitest';
import * as firestore from 'firebase/firestore';
import * as storage from 'firebase/storage';

export const mockSetDoc = vi.mocked(firestore.setDoc);
export const mockGetDoc = vi.mocked(firestore.getDoc);
export const mockOnSnapshot = vi.mocked(firestore.onSnapshot);
export const mockCollection = vi.mocked(firestore.collection);
export const mockQuery = vi.mocked(firestore.query);

export const mockUploadBytes = vi.mocked(storage.uploadBytes);
export const mockUploadBytesResumable = vi.mocked(storage.uploadBytesResumable);
