'use client';

import Link from 'next/link';
import { BrandDoc } from '@/lib/types';
import BrandPicker from './BrandPicker';

type FeedTab = 'review' | 'saved' | 'approved';

interface SidebarProps {
  brands: BrandDoc[];
  selectedBrandId: string | null;
  onSelectBrand: (id: string) => void;
  email?: string | null;
  onSignOut: () => void;
  active: FeedTab;
  onTab: (tab: FeedTab) => void;
  counts: { review: number; saved: number; approved: number };
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
};

export default function Sidebar({
  brands, selectedBrandId, onSelectBrand, email, onSignOut, active, onTab, counts,
}: SidebarProps) {
  const initial = (email || 'U').trim().charAt(0).toUpperCase();
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
        <button type="button" className={`nf-link ${active === 'review' ? 'active' : ''}`} onClick={() => onTab('review')}>
          {Icon.feed}<span>Needs Review</span>
          {counts.review > 0 && <span className="nf-pill">{counts.review}</span>}
        </button>
        <button type="button" className={`nf-link ${active === 'saved' ? 'active' : ''}`} onClick={() => onTab('saved')}>
          {Icon.saved}<span>Saved</span>
          {counts.saved > 0 && <span className="nf-pill">{counts.saved}</span>}
        </button>
        <button type="button" className={`nf-link ${active === 'approved' ? 'active' : ''}`} onClick={() => onTab('approved')}>
          {Icon.approved}<span>Approved</span>
          {counts.approved > 0 && <span className="nf-pill">{counts.approved}</span>}
        </button>
      </nav>

      <div className="nf-nav-label">Create</div>
      <nav className="nf-nav">
        <Link href="/intake" className="nf-link">
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
