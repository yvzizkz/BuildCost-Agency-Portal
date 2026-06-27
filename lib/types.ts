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
  businessType?: string;
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
  // Optional owner intent (intent-capture form). Absent => the bridge cold-starts 'not_sure',
  // so triage + strategy still run and produce a calendar to review.
  brief?: IntentBrief;
}

// --- Content pipeline read models (bridge-projected, client read-only) ----------------

// The captured intent behind a submission: written by the intake form (write side) AND
// surfaced as a subset from the engine brief.json (read side / TriageReport). All-optional so
// one type serves both — the form validates required fields at runtime; cold-start omits them.
export interface IntentBrief {
  businessType?: string;
  motivation?: string;
  suggestedMotivation?: string | null;
  objective?: 'awareness' | 'leads' | 'booked_jobs' | 'reviews' | string;
  channel?: 'organic' | 'ads' | 'both' | string;
  offer?: string;
  mustSay?: string[];
  audienceNote?: string;
  mediaRights?: { ownFootage: boolean; peopleInIt: boolean };
}

export interface TriageAssetScore {
  quality: number | null;
  relevance: number | null;
  messaging: number | null;
  overall: number | null;
  verdict: 'use' | 'enhance' | 'skip';
  captionAngle: string;
  notes: string;
  defects: string[];
}

export interface TriageAsset {
  file: string;
  kind: 'image' | 'video';
  scores: TriageAssetScore;
  enhanced?: string | null;
  enhanceNote?: string;
  derivedStills?: string[];
  stillScores?: (TriageAssetScore & { still: string; enhanced?: string | null })[];
}

// agencies/{a}/brands/{b}/triageReports/{submissionId}
export interface TriageReport {
  schemaVersion: number;
  brand: string;
  submissionId: string;
  triagedAt: string;
  brief: IntentBrief;
  research: { briefId?: string; objective?: string; contentPillars?: string[] };
  template: { key: string; cadence?: string; routesReady: string[]; routesPhase2: string[] };
  assets: TriageAsset[];
  recommendedBundle: { routesReady: string[]; routesPhase2: string[]; topAssets: string[] };
  humanGate: string;
  mirroredAt?: Timestamp | string | number;
}

// One dated cell on the calendar — renderable (date/channel/pillar/hook) AND generatable
// (route -> provider/model/kind/aspect/style + optional sourceAsset).
export interface StrategySlot {
  n: number;
  date: string;            // UTC, GHL '…000Z' format
  localDate: string;
  dayOfWeek: string;
  route: string;
  routeStatus: 'ready' | 'phase2' | string;
  provider: string;
  model: string;
  kind: 'image' | 'video' | string;
  aspect: string;
  style?: string;
  needsSource: boolean;
  creativeDirection?: string;
  channel: string;
  pillar: string;
  sourceAsset: string | null; // basename only
  hook: string;
  captionDirection?: string;
  status: 'planned' | string;
}

// agencies/{a}/brands/{b}/strategies/{submissionId}
export interface Strategy {
  strategyId: string;
  submissionId?: string;
  brand: string | null;
  plannedAt: string;
  horizon: 'week' | 'month' | string;
  horizonDays: number;
  businessType: string;
  motivation: string;
  motivationLabel?: string;
  suggestedMotivation?: string | null;
  objective: string;
  channel: string;
  offer?: string;
  mustSay: string[];
  theme: string;
  cadence: {
    postDays: string[];
    postTimeLocal: string;
    timezone: string;
    postsPerWeek: number;
    totalSlots: number;
    templateCadenceHint?: string;
  };
  channelMix: Record<string, number>;
  pillars: string[];
  research: { briefId?: string; objective?: string; contentPillars?: string[] };
  routesReady: string[];
  routesPhase2: string[];
  summary: { totalSlots: number; readySlots: number; phase2Slots: number; assetsUsed: number; channels: Record<string, number> };
  enrichment: string;
  humanGate: string;
  slots: StrategySlot[];
  mirroredAt?: Timestamp | string | number;
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
