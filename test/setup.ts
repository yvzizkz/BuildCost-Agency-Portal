import '@testing-library/jest-dom/vitest';
import { vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Mock Firebase
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
  getApp: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: null,
  })),
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithEmailLink: vi.fn(),
  isSignInWithEmailLink: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((...args) => args),
  doc: vi.fn((...args) => ({ id: 'mock-doc-id', path: args.join('/') })),
  setDoc: vi.fn(() => Promise.resolve()),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  query: vi.fn((...args) => args),
  where: vi.fn((...args) => args),
  orderBy: vi.fn((...args) => args),
  onSnapshot: vi.fn((q, cb, errCb) => {
    return () => {};
  }),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: vi.fn((s, path) => ({ path })),
  uploadBytes: vi.fn(() => Promise.resolve()),
  // Resumable task: immediately reports full progress then completes.
  uploadBytesResumable: vi.fn((storageRef, file) => ({
    on: (
      _event: string,
      next?: (snap: { bytesTransferred: number; totalBytes: number }) => void,
      _error?: (err: unknown) => void,
      complete?: () => void
    ) => {
      const size = (file && typeof file.size === 'number') ? file.size : 0;
      if (next) next({ bytesTransferred: size, totalBytes: size });
      if (complete) complete();
    },
  })),
}));

// Also mock the local firebase.ts to ensure it uses the mocked versions
vi.mock('@/lib/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  storage: {},
  app: {},
}));
