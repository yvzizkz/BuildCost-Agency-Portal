'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc, QueueItem, MetricsSummary, MetricBlockStatus } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeToMetrics, subscribeToQueue } from '@/lib/queue';
import Sidebar from '@/components/Sidebar';

// ---- formatting helpers -----------------------------------------------------
const fmtNum = (n: number | null | undefined): string =>
  typeof n === 'number' ? n.toLocaleString('en-US') : '—';
const fmtUsd = (n: number | null | undefined): string =>
  typeof n === 'number' ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtPct = (n: number | null | undefined): string =>
  typeof n === 'number' ? `${n}%` : '—';
const fmtPos = (n: number | null | undefined): string =>
  typeof n === 'number' ? (Math.round(n * 10) / 10).toString() : '—';

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- block status pill ------------------------------------------------------
const STATUS_META: Record<MetricBlockStatus, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'ok' },
  empty: { label: 'No data yet', tone: 'muted' },
  'pending-producer': { label: 'Coming soon', tone: 'info' },
  disabled: { label: 'Off', tone: 'muted' },
};
function StatusPill({ status }: { status: MetricBlockStatus }) {
  const m = STATUS_META[status] || STATUS_META.empty;
  return <span className={`dash-pill tone-${m.tone}`}>{m.label}</span>;
}

// Rank position chip — color by how strong the position is.
function PosChip({ pos }: { pos: number | null }) {
  if (typeof pos !== 'number') return <span className="dash-chip tone-muted">—</span>;
  const tone = pos <= 3 ? 'ok' : pos <= 10 ? 'warn' : 'muted';
  return <span className={`dash-chip tone-${tone}`}>#{Math.round(pos)}</span>;
}

const Ico = {
  leads: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>,
  deal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  rank: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  spend: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
};

export default function DashboardPage() {
  const { user, profile, signOut } = useAuth();
  const [brands, setBrands] = useState<BrandDoc[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Brand fetch (mirrors app/page.tsx — no shared brand hook exists).
  useEffect(() => {
    if (profile && profile.brands && profile.brands.length > 0) {
      setLoadingBrands(true);
      (async () => {
        try {
          const resolved = await Promise.all(
            profile.brands.map(async (bid) => {
              const snap = await getDoc(doc(db, 'agencies', profile.agencyId, 'brands', bid));
              return snap.exists() ? ({ slug: bid, ...snap.data() } as BrandDoc) : null;
            })
          );
          const docs = resolved.filter((b): b is BrandDoc => b !== null);
          setBrands(docs);
          if (docs.length > 0) setSelectedBrandId((cur) => cur || docs[0].slug);
        } catch (err) {
          console.error('Error fetching brands:', err);
          setError('Failed to fetch brand permissions.');
        } finally {
          setLoadingBrands(false);
        }
      })();
    }
  }, [profile]);

  // Metrics snapshot (single doc) + live queue (for the content-pipeline view).
  useEffect(() => {
    if (profile && selectedBrandId) {
      setLoadingMetrics(true);
      const unsubMetrics = subscribeToMetrics(
        profile.agencyId,
        selectedBrandId,
        (s) => { setSummary(s); setLoadingMetrics(false); },
        (err) => { console.error('Metrics subscription error:', err); setError('Failed to load metrics.'); setLoadingMetrics(false); }
      );
      const unsubQueue = subscribeToQueue(
        profile.agencyId,
        selectedBrandId,
        (items) => setQueueItems(items),
        (err) => console.error('Queue subscription error:', err)
      );
      return () => { unsubMetrics(); unsubQueue(); };
    } else {
      setSummary(null);
      setQueueItems([]);
    }
  }, [profile, selectedBrandId]);

  const selectedBrand = brands.find((b) => b.slug === selectedBrandId) || null;
  const blocks = summary?.blocks;

  // --- content pipeline, derived LIVE from the mirrored queue (freshest source) ---
  const needsReview = queueItems.filter((i) => i.status !== 'approved' && i.status !== 'rejected').length;
  const approved = queueItems.filter((i) => i.status === 'approved').length;
  const scheduled = queueItems.filter((i) => !!i.scheduleDate);
  const channelMix: Record<string, number> = {};
  for (const i of queueItems) for (const ch of i.targetChannels || []) channelMix[ch] = (channelMix[ch] || 0) + 1;
  const upcoming = [...scheduled]
    .sort((a, b) => Date.parse(a.scheduleDate || '') - Date.parse(b.scheduleDate || ''))
    .slice(0, 6);

  const funnel = blocks?.funnel;
  const seo = blocks?.seo;
  const engagement = blocks?.engagement;
  const spend = blocks?.spend;

  // funnel bar widths relative to the top of the funnel (contacts).
  const funnelMax = Math.max(1, ...(funnel?.stages || []).map((s) => (typeof s.value === 'number' ? s.value : 0)));

  return (
    <div className="app-shell">
      <Sidebar
        brands={brands}
        selectedBrandId={selectedBrandId}
        onSelectBrand={(bid) => setSelectedBrandId(bid)}
        email={user?.email}
        onSignOut={signOut}
      />

      <main className="nf-main">
        <div className="nf-feed-head">
          <h1 className="nf-feed-title">Performance &amp; SEO</h1>
          <p className="nf-feed-sub">
            {selectedBrand ? selectedBrand.displayName : 'Select a brand to see its metrics'}
            {summary?.generatedAt && <> · snapshot {fmtDateTime(summary.generatedAt)}</>}
          </p>
        </div>

        {error && <div className="feed-container"><div className="error-banner">{error}</div></div>}

        {loadingBrands || loadingMetrics ? (
          <div className="feed-container">
            <div className="nf-skeleton" /><div className="nf-skeleton" /><div className="nf-skeleton" />
          </div>
        ) : !selectedBrandId ? (
          <div className="empty-state"><h3>No brand selected</h3><p>Pick a brand to view its dashboard.</p></div>
        ) : !summary ? (
          <div className="empty-state">
            <h3>No metrics snapshot yet</h3>
            <p>Metrics appear here once the engine generates this brand&apos;s first snapshot (CRM funnel, search rankings, spend). It refreshes automatically.</p>
          </div>
        ) : (
          <div className="dash">
            {/* ---- Headline KPIs ---- */}
            <div className="nf-stat-grid">
              <div className="nf-stat tone-accent"><span className="nf-stat-ico">{Ico.leads}</span><b>{fmtNum(funnel?.contacts)}</b><span>Leads (contacts)</span></div>
              <div className="nf-stat tone-ok"><span className="nf-stat-ico">{Ico.deal}</span><b>{fmtNum(funnel?.opportunities)}</b><span>Opportunities</span></div>
              <div className="nf-stat tone-accent"><span className="nf-stat-ico">{Ico.search}</span><b>{fmtNum(seo?.impressions)}</b><span>Search impressions</span></div>
              <div className="nf-stat tone-warn"><span className="nf-stat-ico">{Ico.rank}</span><b>{fmtPos(seo?.avgPosition)}</b><span>Avg. position</span></div>
              <div className="nf-stat tone-ok"><span className="nf-stat-ico">{Ico.calendar}</span><b>{fmtNum(scheduled.length)}</b><span>Posts scheduled</span></div>
              <div className="nf-stat tone-muted"><span className="nf-stat-ico">{Ico.spend}</span><b>{fmtUsd(spend?.spentUsd)}</b><span>Gen. spend ({spend?.month || '—'})</span></div>
            </div>

            {/* ---- Lead funnel ---- */}
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Lead funnel</h2>
                {funnel && <StatusPill status={funnel.status} />}
                {funnel?.asOf && <span className="dash-asof">CRM as of {fmtDate(funnel.asOf)}</span>}
              </div>
              {funnel?.status === 'live' ? (
                <>
                  <div className="dash-funnel">
                    {(funnel.stages || []).map((s) => {
                      const v = typeof s.value === 'number' ? s.value : 0;
                      return (
                        <div className="dash-funnel-row" key={s.key}>
                          <span className="dash-funnel-label">{s.label}</span>
                          <div className="dash-bar-track">
                            <div className="dash-bar" style={{ width: `${Math.max(4, (v / funnelMax) * 100)}%` }} />
                          </div>
                          <span className="dash-funnel-val">{fmtNum(s.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="dash-meta-row">
                    <span>Contacts → Opps: <b>{fmtPct(funnel.conversionPct?.contactsToOpps)}</b></span>
                    <span>Opps → Won: <b>{fmtPct(funnel.conversionPct?.oppsToWon)}</b></span>
                    <span>Won value: <b>{fmtUsd(funnel.wonValueUsd)}</b></span>
                  </div>
                </>
              ) : (
                <p className="dash-note">{funnel?.note || 'No funnel data yet.'}</p>
              )}
            </section>

            {/* ---- Search / SEO ---- */}
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Search visibility</h2>
                {seo && <StatusPill status={seo.status} />}
                {seo?.asOf && <span className="dash-asof">GSC as of {fmtDate(seo.asOf)}</span>}
              </div>
              {seo?.status === 'live' ? (
                <>
                  <div className="dash-inline-stats">
                    <div><b>{fmtNum(seo.impressions)}</b><span>Impressions</span></div>
                    <div><b>{fmtNum(seo.clicks)}</b><span>Clicks</span></div>
                    <div><b>{fmtPct(seo.ctrPct)}</b><span>CTR</span></div>
                    <div><b>{fmtPos(seo.avgPosition)}</b><span>Avg. position</span></div>
                    <div><b>{fmtNum(seo.queryCount)}</b><span>Queries</span></div>
                  </div>
                  {seo.topQueries && seo.topQueries.length > 0 ? (
                    <table className="dash-table">
                      <thead><tr><th>Query</th><th className="r">Rank</th><th className="r">Impr.</th><th className="r">Clicks</th></tr></thead>
                      <tbody>
                        {seo.topQueries.map((q) => (
                          <tr key={q.query}>
                            <td>{q.query}</td>
                            <td className="r"><PosChip pos={q.position} /></td>
                            <td className="r">{fmtNum(q.impressions)}</td>
                            <td className="r">{fmtNum(q.clicks)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="dash-note">No ranking queries in the window yet.</p>}
                  {seo.property && <p className="dash-foot">{seo.property}</p>}
                </>
              ) : (
                <p className="dash-note">{seo?.note || 'No search data yet.'}</p>
              )}
            </section>

            {/* ---- Content pipeline (live from queue) ---- */}
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Content pipeline</h2>
                <span className="dash-pill tone-ok">Live</span>
              </div>
              <div className="dash-inline-stats">
                <div><b>{fmtNum(queueItems.length)}</b><span>In queue</span></div>
                <div><b>{fmtNum(needsReview)}</b><span>Needs review</span></div>
                <div><b>{fmtNum(approved)}</b><span>Approved</span></div>
                <div><b>{fmtNum(scheduled.length)}</b><span>Scheduled</span></div>
              </div>
              {Object.keys(channelMix).length > 0 && (
                <div className="dash-chip-row">
                  {Object.entries(channelMix).map(([ch, n]) => (
                    <span className="dash-chip tone-accent" key={ch}>{ch} · {n}</span>
                  ))}
                </div>
              )}
              {upcoming.length > 0 ? (
                <table className="dash-table">
                  <thead><tr><th>Upcoming</th><th>Type</th><th className="r">Goes out</th></tr></thead>
                  <tbody>
                    {upcoming.map((i) => (
                      <tr key={i.queueId}>
                        <td className="dash-trunc">{i.summary}</td>
                        <td><span className="dash-chip tone-muted">{i.type}</span></td>
                        <td className="r">{fmtDateTime(i.scheduleDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="dash-note">Nothing scheduled yet — approve drafts in the Review Queue to schedule them.</p>}
            </section>

            {/* ---- Engagement (honest empty until posts publish) ---- */}
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Post engagement</h2>
                {engagement && <StatusPill status={engagement.status} />}
              </div>
              {engagement?.status === 'live' ? (
                <div className="dash-two-col">
                  <div>
                    <h3 className="dash-sub">Top recipes</h3>
                    {(engagement.topRecipes || []).map((r) => (
                      <div className="dash-kv" key={r.key}><span>{r.key}</span><b>{r.score}</b></div>
                    ))}
                  </div>
                  <div>
                    <h3 className="dash-sub">Top projects</h3>
                    {(engagement.topProjects || []).map((r) => (
                      <div className="dash-kv" key={r.key}><span>{r.key}</span><b>{r.score}</b></div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="dash-note">{engagement?.note || 'Per-platform engagement (likes, comments, shares) will populate once posts publish to the social planner.'}</p>
              )}
            </section>

            {/* ---- AI generation spend ---- */}
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>AI generation spend</h2>
                {spend && <StatusPill status={spend.status} />}
              </div>
              {spend?.status === 'live' ? (
                <>
                  <div className="dash-inline-stats">
                    <div><b>{fmtUsd(spend.spentUsd)}</b><span>This month ({spend.month})</span></div>
                    <div><b>{fmtNum(spend.itemCount)}</b><span>Generations</span></div>
                  </div>
                  {spend.byKind && Object.keys(spend.byKind).length > 0 && (
                    <div className="dash-chip-row">
                      {Object.entries(spend.byKind).map(([k, n]) => (
                        <span className="dash-chip tone-muted" key={k}>{k} · {n}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="dash-note">{spend?.note || 'No generation spend recorded this month.'}</p>
              )}
            </section>
          </div>
        )}
      </main>

      {/* ---- Right rail: freshness + what's coming online ---- */}
      <aside className="nf-rail">
        <div className="nf-rail-title">Data freshness</div>
        {summary ? (
          <div className="dash-freshness">
            <div className="dash-kv"><span>CRM funnel</span><b>{fmtDate(funnel?.asOf)}</b></div>
            <div className="dash-kv"><span>Search (GSC)</span><b>{fmtDate(seo?.asOf)}</b></div>
            <div className="dash-kv"><span>Engagement</span><b>{fmtDate(engagement?.asOf)}</b></div>
            <div className="dash-kv"><span>Pipeline</span><b>Live</b></div>
          </div>
        ) : <p className="nf-feed-sub">No snapshot loaded.</p>}

        <div className="nf-rail-title">Coming online</div>
        {blocks ? (
          <div className="dash-coming">
            {(['engagement', 'reviews', 'gbp', 'paid'] as const)
              .filter((k) => blocks[k] && blocks[k].status !== 'live')
              .map((k) => (
                <div className="dash-coming-item" key={k}>
                  <div className="dash-coming-head">
                    <span className="dash-coming-name">{k === 'gbp' ? 'Google Business' : k}</span>
                    <StatusPill status={blocks[k].status} />
                  </div>
                  {blocks[k].note && <p className="dash-coming-note">{blocks[k].note}</p>}
                </div>
              ))}
          </div>
        ) : <p className="nf-feed-sub">—</p>}
      </aside>
    </div>
  );
}
