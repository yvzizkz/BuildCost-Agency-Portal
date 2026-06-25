'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { BrandDoc } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { uploadAndSubmit } from '@/lib/submissions';
import Link from 'next/link';

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
  
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
        } catch (err: any) {
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
        if (file.size >= 25 * 1024 * 1024) {
          setError(`File ${file.name} is too large. Max size is 25MB.`);
          return;
        }
        if (!file.type.match(/^image\//) && !file.type.match(/^video\//)) {
          setError(`File ${file.name} is not an image or video.`);
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
    if (files.length === 0) {
      setError('At least one image or video file is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await uploadAndSubmit(profile.agencyId, selectedBrandId, user.uid, {
        title: title.trim(),
        neighborhood: neighborhood.trim() || undefined,
        note: note.trim() || undefined,
        files,
        heroIndex,
        processIndexes: Array.from(processIndexes),
      });

      setSuccess('Media package uploaded and intake document created successfully.');
      setTitle('');
      setNeighborhood('');
      setNote('');
      setFiles([]);
      setHeroIndex(0);
      setProcessIndexes(new Set());
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to submit media package.');
    } finally {
      setSubmitting(false);
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
                    onChange={(e) => setSelectedBrandId(e.target.value)}
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
                  <div className="file-dropzone-sub">Images and Videos up to 25MB are supported</div>
                </label>

                {files.length > 0 && (
                  <div className="selected-files-list">
                    {files.map((file, idx) => (
                      <div key={idx} className="selected-file-item">
                        <span className="file-item-name">{file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
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

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || files.length === 0}
              >
                {submitting ? 'Uploading and Submitting...' : 'Submit Media Package'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
