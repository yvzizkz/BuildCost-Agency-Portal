'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc, QueueItem, TriageReport, Strategy } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeToQueue, subscribeToTriageReports, subscribeToStrategies } from '@/lib/queue';
import { requestGeneration } from '@/lib/commands';
import { useSavedItems } from '@/lib/saved';
import QueueCard from '@/components/QueueCard';
import Sidebar from '@/components/Sidebar';
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

  const selectedBrand = brands.find((b) => b.slug === selectedBrandId) || null;

  const tabs: { key: 'review' | 'saved' | 'approved'; label: string; count: number }[] = [
    { key: 'review', label: 'Needs Review', count: reviewItems.length },
    { key: 'saved', label: 'Saved', count: savedItems.length },
    { key: 'approved', label: 'Approved & Scheduled', count: approvedItems.length },
  ];
  const headTitle =
    activeTab === 'review' ? 'Needs Review' :
    activeTab === 'saved' ? 'Saved' : 'Approved & Scheduled';

  return (
    <div className="app-shell">
      <Sidebar
        brands={brands}
        selectedBrandId={selectedBrandId}
        onSelectBrand={(bid) => setSelectedBrandId(bid)}
        email={user?.email}
        onSignOut={signOut}
        active={activeTab}
        onTab={setActiveTab}
        counts={{ review: reviewItems.length, saved: savedItems.length, approved: approvedItems.length }}
      />

      <main className="nf-main">
        <div className="nf-feed-head">
          <h1 className="nf-feed-title">{headTitle}</h1>
          <p className="nf-feed-sub">
            {selectedBrand ? selectedBrand.displayName : 'Select a brand to see its content'}
          </p>
          <div className="queue-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`queue-tab ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
                <span className="tab-count">{t.count}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="feed-container">
            <div className="error-banner">{error}</div>
          </div>
        )}

        {loadingBrands || loadingQueue ? (
          <div className="feed-container">
            <div className="nf-skeleton" />
            <div className="nf-skeleton" />
            <div className="nf-skeleton" />
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
                <p>Save items you want to manually verify later. They&apos;ll appear here.</p>
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
      </main>

      <aside className="nf-rail">
        <div className="nf-rail-title">Content Generator</div>
        {selectedBrandId ? (
          <div className="generation-panel">
            <div className="generation-panel-header">
              <span className="generation-panel-title">Generate content</span>
              {generating && <div className="mini-spinner"></div>}
            </div>
            <p className="nf-feed-sub">Trigger an AI engine directly — new drafts land in the feed.</p>
            <div className="generation-actions">
              <button className="btn-secondary" disabled={generating} onClick={() => handleGenerate('social')}>
                Generate Social Post
              </button>
              <button className="btn-secondary" disabled={generating} onClick={() => handleGenerate('reel')}>
                Generate Reel Video
              </button>
            </div>
            {genSuccess && <div className="success-banner">{genSuccess}</div>}
          </div>
        ) : (
          <p className="nf-feed-sub">Select a brand to generate content.</p>
        )}

        <div className="nf-rail-title">This brand</div>
        <div className="nf-stat-grid">
          <div className="nf-stat"><b>{reviewItems.length}</b><span>Needs review</span></div>
          <div className="nf-stat"><b>{approvedItems.length}</b><span>Approved</span></div>
          <div className="nf-stat"><b>{savedItems.length}</b><span>Saved</span></div>
          <div className="nf-stat"><b>{queueItems.length}</b><span>Total in queue</span></div>
        </div>
      </aside>
    </div>
  );
}
