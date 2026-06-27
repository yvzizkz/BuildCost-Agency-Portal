import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StrategyView from './StrategyView';
import { Strategy } from '@/lib/types';

const mockStrategy: Strategy = {
  strategyId: 'strat123',
  submissionId: 'sub123',
  brand: 'test-brand',
  plannedAt: new Date().toISOString(),
  horizon: 'month',
  horizonDays: 30,
  businessType: 'Construction',
  motivation: 'Showcase work',
  objective: 'leads',
  channel: 'organic',
  mustSay: ['Quality'],
  theme: 'Fall Showcase',
  cadence: {
    postDays: ['Mon', 'Wed', 'Fri'],
    postTimeLocal: '09:00',
    timezone: 'America/New_York',
    postsPerWeek: 3,
    totalSlots: 12,
  },
  channelMix: { instagram: 0.6, facebook: 0.4 },
  pillars: ['Projects', 'Team'],
  research: {},
  routesReady: ['ig_post'],
  routesPhase2: [],
  summary: {
    totalSlots: 12,
    readySlots: 12,
    phase2Slots: 0,
    assetsUsed: 8,
    channels: { instagram: 7, facebook: 5 },
  },
  enrichment: '',
  humanGate: 'pending',
  slots: [
    {
      n: 1,
      date: '2023-10-02T13:00:00Z',
      localDate: '2023-10-02',
      dayOfWeek: 'Monday',
      route: 'ig_post',
      routeStatus: 'ready',
      provider: 'openai',
      model: 'gpt-4',
      kind: 'image',
      aspect: '1:1',
      needsSource: true,
      channel: 'instagram',
      pillar: 'Projects',
      sourceAsset: 'project1.jpg',
      hook: 'Check out our latest project!',
      status: 'planned',
    },
    {
      n: 2,
      date: '2023-10-04T13:00:00Z',
      localDate: '2023-10-04',
      dayOfWeek: 'Wednesday',
      route: 'fb_post',
      routeStatus: 'phase2',
      provider: 'openai',
      model: 'gpt-4',
      kind: 'image',
      aspect: '1.91:1',
      needsSource: true,
      channel: 'facebook',
      pillar: 'Team',
      sourceAsset: null,
      hook: 'Meet the team behind the scenes.',
      status: 'planned',
    }
  ],
};

describe('StrategyView', () => {
  it('renders the strategy header and summary', () => {
    render(<StrategyView strategy={mockStrategy} />);
    expect(screen.getByText('Fall Showcase')).toBeDefined();
    expect(screen.getByText('month')).toBeDefined();
    expect(screen.getAllByText('leads').length).toBeGreaterThan(0);
    expect(screen.getByText(/Mon, Wed, Fri/i)).toBeDefined();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('renders content pillars and channel mix', () => {
    render(<StrategyView strategy={mockStrategy} />);
    expect(screen.getAllByText('Projects').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Team').length).toBeGreaterThan(0);
    expect(screen.getAllByText('instagram').length).toBeGreaterThan(0);
    expect(screen.getByText('60%')).toBeDefined();
  });

  it('renders slots grouped by week', () => {
    render(<StrategyView strategy={mockStrategy} />);
    expect(screen.getByText('Week 1')).toBeDefined();
    expect(screen.getByText('Check out our latest project!')).toBeDefined();
    expect(screen.getByText('Meet the team behind the scenes.')).toBeDefined();
  });

  it('renders slot status badges correctly', () => {
    render(<StrategyView strategy={mockStrategy} />);
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getByText('Coming Soon')).toBeDefined();
  });
});
