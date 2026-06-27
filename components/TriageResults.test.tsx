import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TriageResults from './TriageResults';
import { TriageReport } from '@/lib/types';

// Mock Firebase Storage
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn(() => Promise.resolve('https://example.com/image.jpg')),
}));

vi.mock('@/lib/firebase', () => ({
  storage: {},
}));

const mockReport: TriageReport = {
  schemaVersion: 1,
  brand: 'test-brand',
  submissionId: 'sub123',
  triagedAt: new Date().toISOString(),
  brief: {
    businessType: 'Construction',
    motivation: 'Showcase work',
    objective: 'leads',
  },
  research: {
    objective: 'Build trust',
    contentPillars: ['Quality', 'Reliability'],
  },
  template: {
    key: 'standard-v1',
    cadence: '3 posts/week',
    routesReady: ['instagram_feed'],
    routesPhase2: ['tiktok_reel'],
  },
  assets: [
    {
      file: 'image1.jpg',
      kind: 'image',
      scores: {
        quality: 4,
        relevance: 5,
        messaging: 3,
        overall: 4,
        verdict: 'use',
        captionAngle: 'Before/After',
        notes: 'Great shot',
        defects: [],
      },
    },
    {
      file: 'video1.mp4',
      kind: 'video',
      scores: {
        quality: 2,
        relevance: 3,
        messaging: 2,
        overall: 2,
        verdict: 'skip',
        captionAngle: 'Action shot',
        notes: 'Too blurry',
        defects: ['Blurry'],
      },
    },
  ],
  recommendedBundle: {
    routesReady: ['instagram_feed'],
    routesPhase2: ['tiktok_reel'],
    topAssets: ['image1.jpg'],
  },
  humanGate: 'pending',
};

describe('TriageResults', () => {
  it('renders the triage summary bar', () => {
    render(<TriageResults report={mockReport} />);
    expect(screen.getByText(/Construction · Showcase work · leads/i)).toBeDefined();
    expect(screen.getByText(/Triaged/i)).toBeDefined();
  });

  it('renders the recommended asset bundle', () => {
    render(<TriageResults report={mockReport} />);
    expect(screen.getByText(/Recommended Asset Bundle/i)).toBeDefined();
    expect(screen.getByText('instagram_feed')).toBeDefined();
    expect(screen.getByText('tiktok_reel')).toBeDefined();
    expect(screen.getByText('3 posts/week')).toBeDefined();
  });

  it('renders assets grouped by verdict', () => {
    render(<TriageResults report={mockReport} />);
    expect(screen.getByText('Approved')).toBeDefined();
    expect(screen.getByText('Skipped')).toBeDefined();
    expect(screen.queryByText('Needs Enhancement')).toBeNull();
  });

  it('renders asset details', () => {
    render(<TriageResults report={mockReport} />);
    expect(screen.getByText('Before/After')).toBeDefined();
    expect(screen.getByText('Great shot')).toBeDefined();
    expect(screen.getByText('Too blurry')).toBeDefined();
    expect(screen.getAllByText(/Blurry/i).length).toBeGreaterThan(0);
  });
});
