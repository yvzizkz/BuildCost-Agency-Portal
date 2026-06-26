'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { uploadAndSubmit } from '@/lib/submissions';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { useBrands } from '@/lib/useBrands';
import { BrandDoc } from '@/lib/types';

interface MediaFileListProps {
  files: File[];
  heroIndex: number;
  processIndexes: Set<number>;
  onRemove: (index: number) => void;
  onSetHero: (index: number) => void;
  onToggleProcess: (index: number, checked: boolean) => void;
}

function MediaFileList({
  files,
  heroIndex,
  processIndexes,
  onRemove,
  onSetHero,
  onToggleProcess,
}: MediaFileListProps) {
  if (files.length === 0) return null;

  return (
    <div className="selected-files-list">
      {files.map((file, idx) => (
        <div key={idx} className="selected-file-item">
          <span className="file-item-name">
            {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </span>
          <div className="file-item-controls">
            <label className="file-control-label">
              <input
                type="radio"
                name="hero-select"
                checked={heroIndex === idx}
                onChange={() => onSetHero(idx)}
                className="file-control-radio"
              />
              <span>Hero</span>
            </label>
            <label className="file-control-label">
              <input
                type="checkbox"
                checked={processIndexes.has(idx)}
                onChange={(e) => onToggleProcess(idx, e.target.checked)}
                className="file-control-checkbox"
              />
              <span>In-progress shot</span>
            </label>
            <button
              type="button"
              className="btn-remove-file"
              onClick={() => onRemove(idx)}
              title="Remove file"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface IntakeFormProps {
  brands: BrandDoc[];
  selectedBrandId: string | null;
  setSelectedBrandId: (id: string) => void;
  title: string;
  setTitle: (t: string) => void;
  neighborhood: string;
  setNeighborhood: (n: string) => void;
  note: string;
  setNote: (n: string) => void;
  files: File[];
  heroIndex: number;
  processIndexes: Set<number>;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onSetHero: (index: number) => void;
  onToggleProcess: (index: number, checked: boolean) => void;
}

function IntakeForm({
  brands,
  selectedBrandId,
  setSelectedBrandId,
  title,
  setTitle,
  neighborhood,
  setNeighborhood,
  note,
  setNote,
  files,
  heroIndex,
  processIndexes,
  submitting,
  onSubmit,
  onFileChange,
  onRemoveFile,
  onSetHero,
  onToggleProcess,
}: IntakeFormProps) {
  return (
    <form onSubmit={onSubmit} className="intake-form">
      <div className="form-group">
        <label htmlFor="intake-brand" className="form-label">
          Brand Target
        </label>
        <div className="select-wrapper">
          <select
            id="intake-brand"
            value={selectedBrandId || ''}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="brand-picker-select"
            required
          >
            <option value="" disabled>
              Select target brand...
            </option>
            {brands.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="intake-title" className="form-label">
          Project Title
        </label>
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
        <label htmlFor="intake-neighborhood" className="form-label">
          Neighborhood / Area (Optional)
        </label>
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
        <label htmlFor="intake-note" className="form-label">
          Notes (Optional)
        </label>
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
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <div className="file-dropzone-text">Click to browse image or video files</div>
          <div className="file-dropzone-sub">Images and Videos up to 25MB are supported</div>
        </label>

        <MediaFileList
          files={files}
          heroIndex={heroIndex}
          processIndexes={processIndexes}
          onRemove={onRemoveFile}
          onSetHero={onSetHero}
          onToggleProcess={onToggleProcess}
        />
      </div>

      <button type="submit" className="btn-primary" disabled={submitting || files.length === 0}>
        {submitting ? 'Uploading and Submitting...' : 'Submit Media Package'}
      </button>
    </form>
  );
}

export default function IntakePage() {
  const { user, profile, signOut } = useAuth();
  const {
    brands,
    selectedBrandId,
    setSelectedBrandId,
    loading: loadingBrands,
    error: brandsError,
  } = useBrands(profile);
  
  const [title, setTitle] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [heroIndex, setHeroIndex] = useState<number>(0);
  const [processIndexes, setProcessIndexes] = useState<Set<number>>(new Set());
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      logger.error('IntakePage:handleSubmit', err);
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

            {(error || brandsError) && (
              <div className="error-banner" style={{ marginBottom: '1.5rem' }}>
                {error || brandsError}
              </div>
            )}
            {success && <div className="success-banner" style={{ marginBottom: '1.5rem' }}>{success}</div>}

            <IntakeForm
              brands={brands}
              selectedBrandId={selectedBrandId}
              setSelectedBrandId={setSelectedBrandId}
              title={title}
              setTitle={setTitle}
              neighborhood={neighborhood}
              setNeighborhood={setNeighborhood}
              note={note}
              setNote={setNote}
              files={files}
              heroIndex={heroIndex}
              processIndexes={processIndexes}
              submitting={submitting}
              onSubmit={handleSubmit}
              onFileChange={handleFileChange}
              onRemoveFile={handleRemoveFile}
              onSetHero={(idx) => setHeroIndex(idx)}
              onToggleProcess={(idx, checked) => {
                setProcessIndexes((prev) => {
                  const next = new Set(prev);
                  if (checked) {
                    next.add(idx);
                  } else {
                    next.delete(idx);
                  }
                  return next;
                });
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
