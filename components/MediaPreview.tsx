'use client';

import { useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { DraftAsset } from '@/lib/types';

interface MediaPreviewProps {
  asset: DraftAsset;
}

export default function MediaPreview({ asset }: MediaPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getDownloadURL(ref(storage, asset.storagePath))
      .then((downloadUrl) => {
        if (active) {
          setUrl(downloadUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching storage URL:', err);
        if (active) {
          setError('Failed to load media');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [asset.storagePath]);

  if (loading) {
    return (
      <div className="media-preview-loading">
        <div className="mini-spinner"></div>
        <span>Loading media...</span>
      </div>
    );
  }

  if (error || !url) {
    return <div className="media-preview-error">{error || 'No media found'}</div>;
  }

  if (asset.kind === 'video') {
    return (
      <div className="media-preview-video-container">
        <video src={url} controls className="media-preview-video" preload="metadata" />
        <span className="media-filename">{asset.fileName}</span>
      </div>
    );
  }

  return (
    <div className="media-preview-image-container">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={asset.fileName} className="media-preview-image" />
      <span className="media-filename">{asset.fileName}</span>
    </div>
  );
}
