'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandDoc } from '@/lib/types';
import BrandPicker from './BrandPicker';

type FeedTab = 'review' | 'saved' | 'approved';

interface SidebarProps {
  brands: BrandDoc[];
  selectedBrandId: string | null;
  onSelectBrand: (id: string) => void;
  email?: string | null;
  onSignOut: () => void;
  // Feed-tab props are home-page only. When omitted (e.g. on /dashboard), the Feed
  // group collapses to a single "Review Queue" link back to home.
  active?: FeedTab;
  onTab?: (tab: FeedTab) => void;
  counts?: { review: number; saved: number; approved: number };
}

// Inline stroke icons (currentColor) — no icon dependency.
const Icon = {
  feed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  ),
  saved: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
    </svg>
  ),
  approved: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" /><path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  ),
  intake: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 14h8v7H3z" />
    </svg>
  ),
};

export default function Sidebar({
  brands, selectedBrandId, onSelectBrand, email, onSignOut, active, onTab, counts,
}: SidebarProps) {
  const initial = (email || 'U').trim().charAt(0).toUpperCase();
  const pathname = usePathname();
  const onDashboard = pathname === '/dashboard';
  // The Feed-tab highlight is state-driven (activeTab), decoupled from the route. Gate it on
  // the home route so a client-side <Link> nav to /dashboard or /intake (pathname updates
  // optimistically) doesn't leave "Needs Review" lit alongside the new route link until the
  // destination page mounts. Without this, two items appear active at once.
  const onHome = pathname === '/';
  const c = counts || { review: 0, saved: 0, approved: 0 };
  return (
    <aside className="nf-sidebar">
      <div className="nf-brand">
        <div className="nf-logo">B</div>
        <div className="nf-wordmark">
          <b>BuildCost</b>
          <span>Agency Portal</span>
        </div>
      </div>

      <div className="nf-nav-label">Feed</div>
      <nav className="nf-nav">
        {onTab ? (
          <>
            <button type="button" className={`nf-link ${onHome && active === 'review' ? 'active' : ''}`} onClick={() => onTab('review')}>
              {Icon.feed}<span>Needs Review</span>
              {c.review > 0 && <span className="nf-pill">{c.review}</span>}
            </button>
            <button type="button" className={`nf-link ${onHome && active === 'saved' ? 'active' : ''}`} onClick={() => onTab('saved')}>
              {Icon.saved}<span>Saved</span>
              {c.saved > 0 && <span className="nf-pill">{c.saved}</span>}
            </button>
            <button type="button" className={`nf-link ${onHome && active === 'approved' ? 'active' : ''}`} onClick={() => onTab('approved')}>
              {Icon.approved}<span>Approved</span>
              {c.approved > 0 && <span className="nf-pill">{c.approved}</span>}
            </button>
          </>
        ) : (
          <Link href="/" className="nf-link">
            {Icon.feed}<span>Review Queue</span>
          </Link>
        )}
      </nav>

      <div className="nf-nav-label">Insights</div>
      <nav className="nf-nav">
        <Link href="/dashboard" className={`nf-link ${onDashboard ? 'active' : ''}`}>
          {Icon.dashboard}<span>Dashboard</span>
        </Link>
      </nav>

      <div className="nf-nav-label">Create</div>
      <nav className="nf-nav">
        <Link href="/intake" className={`nf-link ${pathname === '/intake' ? 'active' : ''}`}>
          {Icon.intake}<span>Media Intake</span>
        </Link>
      </nav>

      <div className="nf-nav-label">Brand</div>
      <BrandPicker brands={brands} selectedBrandId={selectedBrandId} onChange={onSelectBrand} />

      <div className="nf-sidebar-foot">
        <div className="nf-user">
          <div className="nf-avatar">{initial}</div>
          <div className="nf-user-meta">
            <b>Owner</b>
            <span>{email || 'Signed in'}</span>
          </div>
        </div>
        <button type="button" className="nf-signout" onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}
