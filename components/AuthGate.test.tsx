import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AuthGate from './AuthGate';
import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

describe('AuthGate', () => {
  it('shows loading state', () => {
    (useAuth as any).mockReturnValue({ loading: true });
    (usePathname as any).mockReturnValue('/');

    render(<AuthGate>Content</AuthGate>);
    expect(screen.getByText('Loading BuildCost Portal...')).toBeInTheDocument();
  });

  it('shows unprovisioned state', () => {
    (useAuth as any).mockReturnValue({
      loading: false,
      user: { email: 'test@example.com' },
      profile: null,
      signOut: vi.fn(),
    });
    (usePathname as any).mockReturnValue('/');

    render(<AuthGate>Content</AuthGate>);
    expect(screen.getByText('Account Not Provisioned')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('renders children when authenticated and provisioned', () => {
    (useAuth as any).mockReturnValue({
      loading: false,
      user: { email: 'test@example.com' },
      profile: { agencyId: 'a1' },
    });
    (usePathname as any).mockReturnValue('/');

    render(<AuthGate>Content</AuthGate>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
