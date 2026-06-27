'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { uploadAndSubmit, MAX_UPLOAD_BYTES } from '@/lib/submissions';
import { ingestDropboxLink, isDropboxUrl } from '@/lib/commands';
import Link from 'next/link';
import { friendlyError, formatBytes } from '@/lib/utils';

export default function IntakePage() {
  const { user, profile, signOut } = useAuth();
  const [brands, setBrands] = useState<BrandDoc[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [heroIndex, setHeroIndex] = useState<number>(0);
  const [processIndexes, setProcessIndexes] = useState<Set<number>>(new Set());

  // Intent Fields
  const [businessType, setBusinessType] = useState('unknown');
  const [motivation, setMotivation] = useState('');
  const [objective, setObjective] = useState<'awareness' | 'leads' | 'booked_jobs' | 'reviews'>('leads');
  const [channel, setChannel] = useState<'organic' | 'ads' | 'both'>('organic');
  const [offer, setOffer] = useState('');
  const [mustSay, setMustSay] = useState('');
  const [ownFootage, setOwnFootage] = useState(false);
  const [peopleInIt, setPeopleInIt] = useState(false);
  
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dropboxUrl, setDropboxUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [ingestErr, setIngestErr] = useState<string | null>(null);

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
            setBusinessType(brandDocs[0].businessType || 'unknown');
          }
        } catch (err: unknown) {
          console.error(err);
          setError('Failed to fetch brand permissions.');
        } finally {
          setLoadingBrands(false);
        }
      };
      fetchAllBrands();
    }
  }, [profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      
      for (const file of selectedFiles) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`"${file.name}" is larger than the 2 GB limit.`);
          return;
        }
        if (!file.type.match(/^image\//) && !file.type.match(/^video\//)) {
          setError(`"${file.name}" is not an image or video.`);
          return;
        }
      }
      
      setFiles((prev) => [...prev, ...selectedFiles]);
      setError(null);
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = prev.filter((_, i) => i !== index);

      setHeroIndex((prevHero) => {
        if (prevHero === index) {
          return 0;
        }
        if (prevHero > index) {
          return prevHero - 1;
        }
        if (newFiles.length === 0) return 0;
        if (prevHero >= newFiles.length) return 0;
        return prevHero;
      });

      setProcessIndexes((prevProcess) => {
        const nextProcess = new Set<number>();
        prevProcess.forEach((idx) => {
          if (idx === index) {
            // removed, do nothing
          } else if (idx > index) {
            nextProcess.add(idx - 1);
          } else {
            nextProcess.add(idx);
          }
        });
        return nextProcess;
      });

      return newFiles;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedBrandId || !user) return;
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!motivation) {
      setError('Please select what you want us to do with this media (Motivation).');
      return;
    }
    if (files.length === 0) {
      setError('At least one image or video file is required.');
      return;
    }

    setSubmitting(true);
    setProgress(0);
    setError(null);
    setSuccess(null);

    try {
      await uploadAndSubmit(
        profile.agencyId,
        selectedBrandId,
        user.uid,
        {
          title: title.trim(),
          neighborhood: neighborhood.trim() || undefined,
          note: note.trim() || undefined,
          files,
          heroIndex,
          processIndexes: Array.from(processIndexes),
          brief: {
            businessType,
            motivation,
            objective,
            channel,
            offer: offer.trim() || undefined,
            mustSay: mustSay.split(',').map(s => s.trim()).filter(s => !!s),
            mediaRights: {
              ownFootage,
              peopleInIt,
            },
          },
        },
        setProgress
      );

      setSuccess('Media uploaded! Your photos are in — we\'ll start generating content shortly.');
      setTitle('');
      setNeighborhood('');
      setNote('');
      setFiles([]);
      setHeroIndex(0);
      setProcessIndexes(new Set());
      setMotivation('');
      setOffer('');
      setMustSay('');
      setOwnFootage(false);
      setPeopleInIt(false);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDropboxIngest = async () => {
    if (!profile || !selectedBrandId || !user) return;
    const url = dropboxUrl.trim();
    setIngestErr(null);
    setIngestMsg(null);
    if (!isDropboxUrl(url)) {
      setIngestErr('That doesn\'t look like a Dropbox link. Paste the full https://www.dropbox.com/… share link.');
      return;
    }
    setIngesting(true);
    try {
      await ingestDropboxLink(profile.agencyId, selectedBrandId, user.uid, url, title.trim() || undefined);
      setIngestMsg('Sent — we\'re saving that file straight into your Google Drive archive. Large files can take a few minutes.');
      setDropboxUrl('');
    } catch (err: unknown) {
      console.error(err);
      setIngestErr(friendlyError(err));
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="brand-title">BuildCost Agency Portal</h1>
        <nav className="header-nav">
          <Link href="/" className="nav-link">
            Queue Feed
          </Link>
          <Link href="/intake" className="nav-link active">
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
          <div className="intake-container">
            <h2 className="intake-title">Media Intake</h2>
            <p className="intake-desc">
              Upload photos or videos of project sites to trigger AI content generation cycles.
            </p>

            {error && <div className="error-banner" style={{ marginBottom: '1.5rem' }}>{error}</div>}
            {success && <div className="success-banner" style={{ marginBottom: '1.5rem' }}>{success}</div>}

            <form onSubmit={handleSubmit} className="intake-form">
              <div className="form-group">
                <label htmlFor="intake-brand" className="form-label">Brand Target</label>
                <div className="select-wrapper">
                  <select
                    id="intake-brand"
                    value={selectedBrandId || ''}
                    onChange={(e) => {
                      const bid = e.target.value;
                      setSelectedBrandId(bid);
                      const brand = brands.find(b => b.slug === bid);
                      if (brand?.businessType) {
                        setBusinessType(brand.businessType);
                      }
                    }}
                    className="brand-picker-select"
                    required
                  >
                    <option value="" disabled>Select target brand...</option>
                    {brands.map((brand) => (
                      <option key={brand.slug} value={brand.slug}>
                        {brand.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="intent-section" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <h3 style={{ gridColumn: '1 / -1', fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Intent & Goals</h3>

                <div className="form-group">
                  <label htmlFor="intake-business-type" className="form-label">Business Type</label>
                  <div className="select-wrapper">
                    <select
                      id="intake-business-type"
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="brand-picker-select"
                    >
                      <option value="construction">Construction</option>
                      <option value="home_services">Home Services</option>
                      <option value="restaurant_food">Restaurant & Food</option>
                      <option value="retail_ecom">Retail & E-commerce</option>
                      <option value="professional_services">Professional Services</option>
                      <option value="health_wellness">Health & Wellness</option>
                      <option value="digital_saas">Digital / SaaS</option>
                      <option value="creator_personal_brand">Creator / Personal Brand</option>
                      <option value="events_hospitality">Events & Hospitality</option>
                      <option value="local_other">Other Local Business</option>
                      <option value="unknown">Unknown / Other</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="intake-motivation" className="form-label">Motivation (Required)</label>
                  <div className="select-wrapper">
                    <select
                      id="intake-motivation"
                      value={motivation}
                      onChange={(e) => setMotivation(e.target.value)}
                      className="brand-picker-select"
                      required
                    >
                      <option value="" disabled>What should we do?</option>
                      <option value="enhance_media">Make my photos/videos look professional</option>
                      <option value="creative_concept">Make something creative or fun (e.g. a cartoon ad)</option>
                      <option value="showcase_work">Show off finished work / a product / a space</option>
                      <option value="promote_offer">Promote an offer, sale, or event</option>
                      <option value="lead_gen_ad">Run a paid ad to get leads/customers</option>
                      <option value="brand_awareness">Tell our story / build trust & awareness</option>
                      <option value="not_sure">I&apos;m not sure where to start</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="intake-objective" className="form-label">Objective</label>
                  <div className="select-wrapper">
                    <select
                      id="intake-objective"
                      value={objective}
                      onChange={(e) => setObjective(e.target.value as any)}
                      className="brand-picker-select"
                    >
                      <option value="leads">Generate Leads</option>
                      <option value="awareness">Build Awareness</option>
                      <option value="booked_jobs">Book More Jobs</option>
                      <option value="reviews">Get More Reviews</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="intake-channel" className="form-label">Channel</label>
                  <div className="select-wrapper">
                    <select
                      id="intake-channel"
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as any)}
                      className="brand-picker-select"
                    >
                      <option value="organic">Organic Social</option>
                      <option value="ads">Paid Ads</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="intake-offer" className="form-label">Special Offer (Optional)</label>
                  <input
                    id="intake-offer"
                    type="text"
                    placeholder="e.g. 10% off for first-time customers"
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="intake-must-say" className="form-label">Must-Say Details (Optional, comma-separated)</label>
                  <input
                    id="intake-must-say"
                    type="text"
                    placeholder="e.g. Family owned, Licensed & Insured, Serving Austin"
                    value={mustSay}
                    onChange={(e) => setMustSay(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'row', gap: '2rem', marginTop: '0.5rem' }}>
                  <label className="file-control-label">
                    <input
                      type="checkbox"
                      checked={ownFootage}
                      onChange={(e) => setOwnFootage(e.target.checked)}
                      className="file-control-checkbox"
                    />
                    <span>Is this footage yours?</span>
                  </label>
                  <label className="file-control-label">
                    <input
                      type="checkbox"
                      checked={peopleInIt}
                      onChange={(e) => setPeopleInIt(e.target.checked)}
                      className="file-control-checkbox"
                    />
                    <span>Are identifiable people in it?</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="intake-title" className="form-label">Project Title</label>
                <input
                  id="intake-title"
                  type="text"
                  placeholder="e.g. Master Bathroom Complete"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="intake-neighborhood" className="form-label">Neighborhood / Area (Optional)</label>
                <input
                  id="intake-neighborhood"
                  type="text"
                  placeholder="e.g. Saddlewood North"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="intake-note" className="form-label">Notes (Optional)</label>
                <textarea
                  id="intake-note"
                  placeholder="Instructions for copywriting style, details of materials used..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="form-input"
                  rows={4}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Media Files</label>
                <label htmlFor="file-upload" className="file-dropzone">
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <div className="file-dropzone-text">Click to browse image or video files</div>
                  <div className="file-dropzone-sub">Photos and videos up to 2 GB are supported</div>
                </label>

                {files.length > 0 && (
                  <div className="selected-files-list">
                    {files.map((file, idx) => (
                      <div key={idx} className="selected-file-item">
                        <span className="file-item-name">{file.name} ({formatBytes(file.size)})</span>
                        <div className="file-item-controls">
                          <label className="file-control-label">
                            <input
                              type="radio"
                              name="hero-select"
                              checked={heroIndex === idx}
                              onChange={() => setHeroIndex(idx)}
                              className="file-control-radio"
                            />
                            <span>Hero</span>
                          </label>
                          <label className="file-control-label">
                            <input
                              type="checkbox"
                              checked={processIndexes.has(idx)}
                              onChange={(e) => {
                                setProcessIndexes((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) {
                                    next.add(idx);
                                  } else {
                                    next.delete(idx);
                                  }
                                  return next;
                                });
                              }}
                              className="file-control-checkbox"
                            />
                            <span>In-progress shot</span>
                          </label>
                          <button
                            type="button"
                            className="btn-remove-file"
                            onClick={() => handleRemoveFile(idx)}
                            title="Remove file"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {submitting && (
                <div className="upload-progress" aria-label={`Upload ${progress}% complete`}>
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                  <span className="upload-progress-label">{progress}% uploaded</span>
                </div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || files.length === 0}
              >
                {submitting ? `Uploading… ${progress}%` : 'Submit Media Package'}
              </button>
            </form>

            <div className="dropbox-ingest">
              <div className="dropbox-divider"><span>or send a big file from Dropbox</span></div>
              <p className="dropbox-help">
                Got files too large to upload here (long videos, big photo sets)? Paste a Dropbox
                share link and we&apos;ll pull it straight into your Google Drive archive — no size worry.
              </p>
              {ingestErr && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{ingestErr}</div>}
              {ingestMsg && <div className="success-banner" style={{ marginBottom: '0.75rem' }}>{ingestMsg}</div>}
              <div className="dropbox-row">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://www.dropbox.com/s/…?dl=0"
                  value={dropboxUrl}
                  onChange={(e) => setDropboxUrl(e.target.value)}
                  className="form-input"
                  aria-label="Dropbox share link"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDropboxIngest}
                  disabled={ingesting || !dropboxUrl.trim()}
                >
                  {ingesting ? 'Sending…' : 'Send to Drive'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
