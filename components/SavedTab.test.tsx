import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HomePage from '../app/page';
import { useAuth } from '@/lib/auth';
import { subscribeToQueue, subscribeToTriageReports, subscribeToStrategies } from '@/lib/queue';
import { getDoc } from 'firebase/firestore';

// Mock dependencies
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/queue', () => ({
  subscribeToQueue: vi.fn(),
  subscribeToTriageReports: vi.fn(() => vi.fn()),
  subscribeToStrategies: vi.fn(() => vi.fn()),
  fetchDraft: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

const mockItems = [
  { queueId: 'q1', summary: 'Item 1', status: 'pending', type: 'social' },
  { queueId: 'q2', summary: 'Item 2', status: 'pending', type: 'social' },
  { queueId: 'q3', summary: 'Item 3', status: 'approved', type: 'social' },
];

describe('Saved Tab Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      user: { email: 'test@example.com', uid: 'u1' },
      profile: { agencyId: 'a1', brands: ['b1'] },
      signOut: vi.fn(),
    });

    (getDoc as any).mockResolvedValue({
      exists: () => true,
      data: () => ({ displayName: 'Test Brand', slug: 'b1' }),
    });

    // Clear localStorage
    localStorage.clear();
  });

  it('moves an item from Needs Review to Saved when toggled', async () => {
    (subscribeToQueue as any).mockImplementation((_a: any, _b: any, cb: any) => {
      cb(mockItems);
      return vi.fn();
    });

    render(<HomePage />);

    // Wait for loading to finish
    await waitFor(() => expect(screen.queryByText('Syncing brand permissions...')).not.toBeInTheDocument());

    // Initially should be in Needs Review (heading — "Needs Review" also appears as a tab label)
    expect(screen.getByRole('heading', { name: 'Needs Review' })).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();

    // Toggle save on Item 1
    const saveButtons = screen.getAllByTitle('Save for later');
    fireEvent.click(saveButtons[0]);

    // Item 1 should be gone from Needs Review
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();

    // Switch to Saved tab
    const savedTab = screen.getByRole('tab', { name: /Saved/ });
    fireEvent.click(savedTab);

    // Item 1 should be in Saved
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument();

    // Unsave Item 1
    const unsaveButton = screen.getByTitle('Remove from Saved');
    fireEvent.click(unsaveButton);

    // Should show empty state in Saved tab
    expect(screen.getByText('No saved items')).toBeInTheDocument();

    // Switch back to Needs Review
    fireEvent.click(screen.getByRole('tab', { name: /Needs Review/ }));
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });
});
