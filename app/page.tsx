'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc, QueueItem, TriageReport, Strategy } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeToQueue, subscribeToTriageReports, subscribeToStrategies } from '@/lib/queue';
import { requestGeneration } from '@/lib/commands';
import { useSavedItems } from '@/lib/saved';
import BrandPicker from '@/components/BrandPicker';
import QueueCard from '@/components/QueueCard';
import Link from 'next/link';
import { friendlyError } from '@/lib/utils';

export default function HomePage() {
  const { user, profile, signOut } = useAuth();
  const [brands, setBrands] = useState<BrandDoc[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [triageReports, setTriageReports] = useState<Record<string, TriageReport>>({});
  const [strategies, setStrategies] = useState<Record<string, Strategy>>({});
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'review' | 'saved' | 'approved'>('review');
  const { savedIds, toggleSave } = useSavedItems();

  useEffect(() => {
    if (profile && profile.brands && profile.brands.length > 0) {
      setLoadingBrands(true);
      const fetchAllBrands = async () => {
        try {
          const brandPromises = profile.brands.map(async (bid) => {
            const brandDocRef = doc(db, 'agencies', profile.agencyId, 'brands', bid);
            const docSnap = await getDoc(brandDocRef);
            if (docSnap.exists()) {
              return { slug: bid, ...docSnap.data() } as BrandDoc;
            }
            return null;
          });
          const resolvedBrands = await Promise.all(brandPromises);
          const brandDocs = resolvedBrands.filter((b): b is BrandDoc => b !== null);
          setBrands(brandDocs);
          if (brandDocs.length > 0) {
            setSelectedBrandId(brandDocs[0].slug);
          }
        } catch (err: unknown) {
          console.error('Error fetching brands:', err);
          setError('Failed to fetch brand permissions.');
        } finally {
          setLoadingBrands(false);
        }
      };
      fetchAllBrands();
    }
  }, [profile]);

  useEffect(() => {
    if (profile && selectedBrandId) {
      setLoadingQueue(true);
      const unsubscribeQueue = subscribeToQueue(
        profile.agencyId,
        selectedBrandId,
        (items) => {
          setQueueItems(items);
          setLoadingQueue(false);
        },
        (err) => {
          console.error('Queue subscription error:', err);
          setError('Failed to load queue items.');
          setLoadingQueue(false);
        }
      );
      const unsubscribeTriage = subscribeToTriageReports(
        profile.agencyId,
        selectedBrandId,
        (reports) => {
          setTriageReports(reports);
        },
        (err) => {
          console.error('Triage reports subscription error:', err);
        }
      );
      const unsubscribeStrategies = subscribeToStrategies(
        profile.agencyId,
        selectedBrandId,
        (strats) => {
          setStrategies(strats);
        },
        (err) => {
          console.error('Strategies subscription error:', err);
        }
      );
      return () => {
        unsubscribeQueue();
        unsubscribeTriage();
        unsubscribeStrategies();
      };
    } else {
      setQueueItems([]);
    }
  }, [profile, selectedBrandId]);

  const handleGenerate = async (producer: 'social' | 'reel') => {
    if (!profile || !selectedBrandId || !user || generating) return;
    setGenerating(true);
    setError(null);
    setGenSuccess(null);
    try {
      await requestGeneration(profile.agencyId, selectedBrandId, user.uid, producer);
      setGenSuccess(`Requested generation for "${producer === 'social' ? 'Social Post' : 'Reel Video'}"`);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  };

  // Split the feed: the review tab shows only what needs the owner; approved posts
  // move to their own tab (history + schedule + GHL status). Rejected items have
  // been sent back for revision and drop out of both lists.
  // "Saved" items move from review to their own tab.
  const approvedItems = queueItems.filter((i) => i.status === 'approved');
  const rejectedItems = queueItems.filter((i) => i.status === 'rejected');

  const savedItems = queueItems.filter(
    (i) => savedIds.has(i.queueId) && i.status !== 'approved' && i.status !== 'rejected'
  );

  const reviewItems = queueItems.filter(
    (i) =>
      i.status !== 'approved' &&
      i.status !== 'rejected' &&
      !savedIds.has(i.queueId)
  );

  const visibleItems =
    activeTab === 'review' ? reviewItems :
    activeTab === 'saved' ? savedItems :
    approvedItems;

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="brand-title">BuildCost Agency Portal</h1>
        <nav className="header-nav">
          <Link href="/" className="nav-link active">
            Queue Feed
          </Link>
          <Link href="/intake" className="nav-link">
            Media Intake
          </Link>
          {user && (
            <div className="user-badge">
              <span>{user.email}</span>
              <button onClick={signOut} className="btn-signout">
                Sign Out
              </button>
            </div>
          )}
        </nav>
      </header>

      <main>
        {loadingBrands ? (
          <div className="auth-loading-container">
            <div className="spinner"></div>
            <p>Syncing brand permissions...</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 300px' }}>
                <BrandPicker
                  brands={brands}
                  selectedBrandId={selectedBrandId}
                  onChange={(bid) => setSelectedBrandId(bid)}
                />
              </div>

              {selectedBrandId && (
                <div className="generation-panel" style={{ flex: '2 1 400px' }}>
                  <div className="generation-panel-header">
                    <span className="generation-panel-title">Content Generator</span>
                    {generating && <div className="mini-spinner"></div>}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Trigger AI generation engines directly. Created drafts will appear in the queue feed below.
                  </p>
                  <div className="generation-actions">
                    <button
                      className="btn-secondary"
                      disabled={generating}
                      onClick={() => handleGenerate('social')}
                    >
                      Generate Social Post
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={generating}
                      onClick={() => handleGenerate('reel')}
                    >
                      Generate Reel Video
                    </button>
                  </div>
                  {genSuccess && <div className="success-banner" style={{ marginTop: '0.5rem' }}>{genSuccess}</div>}
                </div>
              )}
            </div>

            {error && <div className="error-banner" style={{ marginBottom: '1.5rem' }}>{error}</div>}

            <div className="queue-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={activeTab === 'review'}
                className={`queue-tab ${activeTab === 'review' ? 'active' : ''}`}
                onClick={() => setActiveTab('review')}
              >
                Needs Review<span className="tab-count">{reviewItems.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'saved'}
                className={`queue-tab ${activeTab === 'saved' ? 'active' : ''}`}
                onClick={() => setActiveTab('saved')}
              >
                Saved<span className="tab-count">{savedItems.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'approved'}
                className={`queue-tab ${activeTab === 'approved' ? 'active' : ''}`}
                onClick={() => setActiveTab('approved')}
              >
                Approved &amp; Scheduled<span className="tab-count">{approvedItems.length}</span>
              </button>
            </div>

            {loadingQueue ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <div className="spinner"></div>
                <p>Loading queue…</p>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="empty-state">
                {activeTab === 'review' ? (
                  <>
                    <h3>You&apos;re all caught up</h3>
                    <p>Nothing is waiting for your review right now.</p>
                  </>
                ) : activeTab === 'saved' ? (
                  <>
                    <h3>No saved items</h3>
                    <p>Save items you want to manual verify later. They&apos;ll appear here.</p>
                  </>
                ) : (
                  <>
                    <h3>No approved posts yet</h3>
                    <p>Posts you approve will move here, with their schedule date and GoHighLevel status.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="feed-container">
                {visibleItems.map((item) => (
                  <QueueCard
                    key={item.queueId}
                    item={item}
                    triageReport={triageReports[item.queueId]}
                    strategy={strategies[item.queueId]}
                    agencyId={profile?.agencyId || ''}
                    brandId={selectedBrandId || ''}
                    uid={user?.uid || ''}
                    isSaved={savedIds.has(item.queueId)}
                    onToggleSave={() => toggleSave(item.queueId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
