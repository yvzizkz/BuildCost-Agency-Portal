import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QueueCard from './QueueCard';
import { approve, reject, requestGeneration } from '@/lib/commands';
import { fetchDraft } from '@/lib/queue';

vi.mock('@/lib/commands', () => ({
  approve: vi.fn(),
  reject: vi.fn(),
  requestGeneration: vi.fn(),
}));

vi.mock('@/lib/queue', () => ({
  fetchDraft: vi.fn(() => Promise.resolve(null)),
}));

const mockItem = {
  queueId: 'q1',
  type: 'intake',
  status: 'pending',
  summary: 'Test Item',
  projectId: 'p1',
};

describe('QueueCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" onToggleSave={vi.fn()} />);
    expect(screen.getByText('Test Item')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Request Revisions')).toBeInTheDocument();
    expect(screen.getByTitle('Save for later')).toBeInTheDocument();
  });

  it('calls onToggleSave when save button is clicked', () => {
    const onToggleSave = vi.fn();
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" onToggleSave={onToggleSave} />);
    fireEvent.click(screen.getByTitle('Save for later'));
    expect(onToggleSave).toHaveBeenCalled();
  });

  it('shows saved state correctly', () => {
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" isSaved={true} onToggleSave={vi.fn()} />);
    expect(screen.getByTitle('Remove from Saved')).toBeInTheDocument();
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('calls approve when Approve button is clicked', async () => {
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" />);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('a1', 'b1', 'u1', 'q1'));
  });

  it('requires notes when Request Revisions is clicked', async () => {
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" />);
    fireEvent.click(screen.getByText('Request Revisions'));

    const submitBtn = screen.getByText('Submit Rejection');
    fireEvent.click(submitBtn);

    // reject should NOT have been called because textarea was empty
    expect(reject).not.toHaveBeenCalled();

    const textarea = screen.getByPlaceholderText(/Required: Provide feedback/);
    fireEvent.change(textarea, { target: { value: 'Fix this' } });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(reject).toHaveBeenCalledWith('a1', 'b1', 'u1', 'q1', 'Fix this'));
  });

  it('fans out generation requests', async () => {
    render(<QueueCard item={mockItem as any} agencyId="a1" brandId="b1" uid="u1" />);

    const checkboxes = screen.getAllByRole('checkbox');
    // Default 3 are checked
    const checkedCount = checkboxes.filter((c: any) => c.checked).length;
    expect(checkedCount).toBe(3);

    const generateBtn = screen.getByText(/Generate 3 mockups/);
    fireEvent.click(generateBtn);

    await waitFor(() => expect(requestGeneration).toHaveBeenCalledTimes(3));
  });
});
