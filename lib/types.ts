import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  agencyId: string;
  role: 'owner' | 'admin' | string;
  brands: string[];
}

export interface BrandDoc {
  id?: string;
  slug: string;
  displayName: string;
  status: 'active' | 'inactive' | string;
}

export interface QueueItem {
  queueId: string;
  business: string;
  type: string;
  summary: string;
  action: string;
  status: string;
  createdAt: Timestamp | string | number;
  estMinutes: number;
  draftId?: string;
  mediaCount: number;
  archived: boolean;
  scheduleDate?: string;
  approvedAt?: Timestamp | string | number;
  rejectedAt?: Timestamp | string | number;
  revisionNotes?: string;
  publishCommand?: string;
  projectId?: string;
  source?: string;
  ghlStatus?: string; // 'draft' once approve has pushed it to the GHL Social Planner
  ghlPostId?: string;
}

export interface DraftAsset {
  kind: 'image' | 'video';
  storagePath: string;
  fileName: string;
  source?: string;
  aspect?: string;
  cells?: string[];
}

export interface DraftCopy {
  body?: string;
  hashtags?: string | string[];
  cta?: string;
  // neighborhood shape or other custom properties
  [key: string]: unknown;
}

export interface Draft {
  draftId: string;
  type: string;
  status: string;
  copy: DraftCopy;
  voiceCheck: {
    passed: boolean;
    violations: string[];
  };
  mediaQA?: {
    verdict: 'pass' | 'fail' | string;
    score: number;
    defects: string[];
  };
  assets: DraftAsset[];
}

export interface Submission {
  id?: string;
  uploaderUid: string;
  status: 'requested';
  title: string;
  neighborhood?: string;
  note?: string;
  storagePaths: string[];
  heroStoragePath?: string;
  processStoragePaths?: string[];
  createdAtMs: number;
}

export type CommandType =
  | 'approve'
  | 'reject'
  | 'submitContent'
  | 'requestGeneration'
  | 'editCaption'
  | 'ingestLink';

export interface CommandDoc {
  id?: string;
  type: CommandType;
  status: 'requested';
  requestedByUid: string;
  queueId?: string;
  notes?: string;
  copy?: {
    body?: string;
    hashtags?: string;
    cta?: string;
  };
  payload?: {
    producer?: 'social' | 'reel' | string;
    [key: string]: unknown;
  };
  // ingestLink (Dropbox -> Google Drive archive)
  source?: 'dropbox' | string;
  url?: string;
  title?: string;
  createdAtMs: number;
}

// A file the bridge has archived into the owner's Google Drive (bridge-written, read-only).
export interface DriveAsset {
  id?: string;
  name: string;
  source: 'dropbox' | string;
  driveFileId: string;
  driveLink: string | null;
  bytes: number;
  requestedByUid?: string | null;
  createdAt?: Timestamp | string | number;
}
