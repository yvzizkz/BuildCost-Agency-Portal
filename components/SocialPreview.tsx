'use client';

import { useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { Draft, DraftAsset, QueueItem } from '@/lib/types';

// Renders a draft the way it will actually look once posted — full-quality media in
// the real chrome of each platform (Instagram / Facebook / Reels / Story / TikTok /
// Google Business). One piece of content fans out to several channels, so the owner
// can flip between them. Mobile-first: a phone-width column that fills the screen on
// a phone and centers on desktop.

type Platform = 'instagram' | 'facebook' | 'reels' | 'story' | 'tiktok' | 'gbp';

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  reels: 'Reels',
  story: 'Story',
  tiktok: 'TikTok',
  gbp: 'Google',
};

// Which platforms make sense for a given queue-item type, and which to show first.
function platformsFor(type: string): { list: Platform[]; def: Platform } {
  const t = (type || '').toLowerCase();
  if (t.includes('reel') || t.includes('slideshow')) {
    return { list: ['reels', 'story', 'tiktok', 'instagram', 'facebook'], def: 'reels' };
  }
  if (t.includes('gbp')) {
    return { list: ['gbp', 'instagram', 'facebook'], def: 'gbp' };
  }
  return { list: ['instagram', 'facebook', 'story', 'reels', 'gbp'], def: 'instagram' };
}

function useAssetUrls(assets: DraftAsset[] | undefined): { urls: (string | null)[]; ready: boolean } {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    if (!assets || assets.length === 0) {
      setUrls([]);
      setReady(true);
      return;
    }
    Promise.all(
      assets.map((a) =>
        /^https?:\/\//.test(a.storagePath)
          ? Promise.resolve(a.storagePath)
          : getDownloadURL(ref(storage, a.storagePath)).catch((err) => {
              // A 404 here means the bridge hasn't finished uploading this asset yet
              // (large reel MP4s upload via a resumable session). Log it so a blank
              // frame is diagnosable instead of an infinite, unexplained spinner.
              console.error(`[media] could not resolve ${a.storagePath}:`, err?.code || err?.message || err);
              return null;
            })
      )
    ).then((res) => {
      if (active) {
        setUrls(res);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [assets]);
  return { urls, ready };
}

function handleFrom(name: string): string {
  return (name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function captionParts(draft: Draft) {
  const body = draft?.copy?.body || '';
  const hashtags = Array.isArray(draft?.copy?.hashtags)
    ? draft.copy.hashtags.join(' ')
    : draft?.copy?.hashtags || '';
  const cta = draft?.copy?.cta || '';
  return { body, hashtags, cta };
}

/* ---------- small inline icons (no deps) ---------- */
const Icon = {
  heart: () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
  ),
  comment: () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5z"/></svg>
  ),
  share: () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
  ),
  bookmark: () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
  ),
  more: () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
  ),
  fbLike: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 10v11M2 11h5v10H2zM7 10l3.5-7a2 2 0 0 1 3.8 1.2L13.5 9H20a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 18.7 21H7"/></svg>
  ),
};

interface MediaFrameProps {
  aspect: string;
  url: string | null;
  asset?: DraftAsset;
  count: number;
  idx: number;
  setIdx: (n: number) => void;
  fit?: 'cover' | 'contain';
  ready?: boolean;
}

function MediaFrame({ aspect, url, asset, count, idx, setIdx, fit = 'cover', ready }: MediaFrameProps) {
  const isVideo = asset?.kind === 'video';
  return (
    <div className="sp-frame" style={{ aspectRatio: aspect }}>
      {url ? (
        isVideo ? (
          <video src={url} controls playsInline preload="metadata" className="sp-media" style={{ objectFit: fit }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={asset?.fileName || 'post media'} className="sp-media" style={{ objectFit: fit }} />
        )
      ) : ready ? (
        // URL resolution finished but there's no URL — the asset isn't in Storage yet
        // (usually a reel still uploading). Show a clear state, not a forever-spinner.
        <div className="sp-frame-loading sp-frame-msg">
          {isVideo ? 'Video still processing — check back in a moment.' : 'Media unavailable.'}
        </div>
      ) : (
        <div className="sp-frame-loading"><div className="mini-spinner" /></div>
      )}
      {count > 1 && (
        <>
          <button
            type="button"
            className="sp-nav sp-nav-prev"
            aria-label="Previous"
            onClick={() => setIdx((idx - 1 + count) % count)}
          >
            ‹
          </button>
          <button
            type="button"
            className="sp-nav sp-nav-next"
            aria-label="Next"
            onClick={() => setIdx((idx + 1) % count)}
          >
            ›
          </button>
          <div className="sp-count">{idx + 1}/{count}</div>
          <div className="sp-dots">
            {Array.from({ length: count }).map((_, i) => (
              <span key={i} className={i === idx ? 'on' : ''} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Real brand logos for the social-preview avatar. Brand docs carry no logo field yet, so we
// resolve by the brand/business name; falls back to the initial if there's no match or the
// image fails to load. Assets live in /public/brand-logos.
const BRAND_LOGOS: { test: RegExp; src: string }[] = [
  { test: /saddlewood/i, src: '/brand-logos/saddlewood.png' },
];

function Avatar({ name }: { name: string }) {
  const initial = (name || 'B').trim().charAt(0).toUpperCase();
  const logo = BRAND_LOGOS.find((b) => b.test.test(name || ''))?.src ?? null;
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      <div className="sp-avatar sp-avatar-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={`${name} logo`} onError={() => setFailed(true)} />
      </div>
    );
  }
  return <div className="sp-avatar">{initial}</div>;
}

function Caption({ body, hashtags }: { body: string; hashtags: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > 125;
  const shown = expanded || !long ? body : body.slice(0, 125).trimEnd() + '…';
  return (
    <span>
      {shown}
      {long && !expanded && (
        <button type="button" className="sp-more" onClick={() => setExpanded(true)}>
          more
        </button>
      )}
      {hashtags && <span className="sp-hashtags"> {hashtags}</span>}
    </span>
  );
}

export default function SocialPreview({
  item,
  draft,
  brandName,
}: {
  item: QueueItem;
  draft: Draft;
  brandName: string;
}) {
  const { list, def } = platformsFor(item.type);
  const [platform, setPlatform] = useState<Platform>(def);
  const [idx, setIdx] = useState(0);
  const { urls, ready } = useAssetUrls(draft.assets);

  const assets = draft.assets || [];
  const count = assets.length;
  const safeIdx = count ? Math.min(idx, count - 1) : 0;
  const url = urls[safeIdx] ?? null;
  const asset = assets[safeIdx];
  const display = brandName || item.business || 'Brand';
  const handle = handleFrom(display);
  const { body, hashtags, cta } = captionParts(draft);

  const frame = (aspect: string, fit: 'cover' | 'contain' = 'cover') => (
    <MediaFrame aspect={aspect} url={url} ready={ready} asset={asset} count={count} idx={safeIdx} setIdx={setIdx} fit={fit} />
  );

  return (
    <div className="social-preview">
      <div className="sp-pills" role="tablist" aria-label="Preview platform">
        {list.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === platform}
            className={`sp-pill ${p === platform ? 'active' : ''}`}
            onClick={() => setPlatform(p)}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="sp-stage">
        {/* ---------- Instagram feed ---------- */}
        {platform === 'instagram' && (
          <div className="sp-card sp-ig">
            <div className="sp-ig-head">
              <Avatar name={display} />
              <div className="sp-ig-head-name">{handle}</div>
              <span className="sp-ig-more"><Icon.more /></span>
            </div>
            {frame('1 / 1')}
            <div className="sp-ig-actions">
              <div className="sp-ig-left">
                <span><Icon.heart /></span>
                <span><Icon.comment /></span>
                <span><Icon.share /></span>
              </div>
              <span className="sp-ig-save"><Icon.bookmark /></span>
            </div>
            <div className="sp-ig-caption">
              <span className="sp-ig-handle">{handle}</span>{' '}
              <Caption body={body} hashtags={hashtags} />
            </div>
          </div>
        )}

        {/* ---------- Facebook feed ---------- */}
        {platform === 'facebook' && (
          <div className="sp-card sp-fb">
            <div className="sp-fb-head">
              <Avatar name={display} />
              <div>
                <div className="sp-fb-name">{display}</div>
                <div className="sp-fb-meta">Sponsored · 🌐</div>
              </div>
              <span className="sp-ig-more"><Icon.more /></span>
            </div>
            <div className="sp-fb-text">
              <Caption body={body} hashtags={hashtags} />
            </div>
            {frame('1 / 1')}
            {cta && (
              <div className="sp-fb-cta">
                <span>{display}</span>
                <button type="button" className="sp-fb-cta-btn">Learn more</button>
              </div>
            )}
            <div className="sp-fb-actions">
              <span><Icon.fbLike /> Like</span>
              <span><Icon.comment /> Comment</span>
              <span><Icon.share /> Share</span>
            </div>
          </div>
        )}

        {/* ---------- Reels / Story / TikTok (vertical) ---------- */}
        {(platform === 'reels' || platform === 'story' || platform === 'tiktok') && (
          <div className={`sp-card sp-vert sp-vert-${platform}`}>
            <div className="sp-vert-media">
              {frame('9 / 16')}
              {platform === 'story' && <div className="sp-story-bar"><span /></div>}
              <div className="sp-vert-overlay">
                <div className="sp-vert-head">
                  <Avatar name={display} />
                  <span className="sp-vert-handle">{handle}</span>
                  {platform !== 'story' && <span className="sp-vert-follow">Follow</span>}
                </div>
                {platform !== 'story' && (
                  <div className="sp-vert-caption">
                    <span className="sp-vert-handle">{handle}</span>{' '}
                    <Caption body={body} hashtags={hashtags} />
                  </div>
                )}
              </div>
              {platform !== 'story' && (
                <div className="sp-vert-rail">
                  <span><Icon.heart /></span>
                  <span><Icon.comment /></span>
                  <span><Icon.share /></span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- Google Business Profile ---------- */}
        {platform === 'gbp' && (
          <div className="sp-card sp-gbp">
            <div className="sp-gbp-head">
              <Avatar name={display} />
              <div>
                <div className="sp-gbp-name">{display}</div>
                <div className="sp-gbp-meta">Google Business · Update</div>
              </div>
            </div>
            {frame('4 / 3')}
            <div className="sp-gbp-body">
              <Caption body={body} hashtags={hashtags} />
            </div>
            <button type="button" className="sp-gbp-cta">{cta || 'Learn more'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
