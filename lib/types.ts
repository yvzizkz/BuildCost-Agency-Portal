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
  createdAt: any; // Firestore Timestamp
  estMinutes: number;
  draftId?: string;
  mediaCount: number;
  archived: boolean;
  scheduleDate?: string;
  approvedAt?: any;
  rejectedAt?: any;
  revisionNotes?: string;
  publishCommand?: string;
  projectId?: string;
  source?: string;
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
  [key: string]: any;
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

export type CommandType = 'approve' | 'reject' | 'submitContent' | 'requestGeneration';

export interface CommandDoc {
  id?: string;
  type: CommandType;
  status: 'requested';
  requestedByUid: string;
  queueId?: string;
  notes?: string;
  payload?: {
    producer?: 'social' | 'reel' | string;
    [key: string]: any;
  };
  createdAtMs: number;
}
