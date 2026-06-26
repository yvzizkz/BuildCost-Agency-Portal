'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc, QueueItem } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeToQueue } from '@/lib/queue';
import { requestGeneration } from '@/lib/commands';
import BrandPicker from '@/components/BrandPicker';
import QueueCard from '@/components/QueueCard';
import Link from 'next/link';
import { getErrorMessage } from '@/lib/utils';

export default function HomePage() {
  const { user, profile, signOut } = useAuth();
  const [brands, setBrands] = useState<BrandDoc[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (profile && profile.brands && profile.brands.length > 0) {
      setLoadingBrands(true);
      const fetchAllBrands = async () => {
        try {
          const brandDocs: BrandDoc[] = [];
          for (const bid of profile.brands) {
            const brandDocRef = doc(db, 'agencies', profile.agencyId, 'brands', bid);
            const docSnap = await getDoc(brandDocRef);
            if (docSnap.exists()) {
              brandDocs.push({ slug: bid, ...docSnap.data() } as BrandDoc);
            }
          }
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
      const unsubscribe = subscribeToQueue(
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
      return () => unsubscribe();
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
      setError(getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

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

            <h2 style={{ marginBottom: '1.5rem', fontWeight: 700, fontSize: '1.5rem' }}>
              Approval Queue
            </h2>

            {loadingQueue ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <div className="spinner"></div>
                <p>Loading brand queue items...</p>
              </div>
            ) : queueItems.length === 0 ? (
              <div className="empty-state">
                <h3>No Active Queue Items</h3>
                <p>There are no items currently awaiting review for this brand.</p>
              </div>
            ) : (
              <div className="feed-container">
                {queueItems.map((item) => (
                  <QueueCard
                    key={item.queueId}
                    item={item}
                    agencyId={profile?.agencyId || ''}
                    brandId={selectedBrandId || ''}
                    uid={user?.uid || ''}
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
