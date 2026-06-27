'use client';

import { TriageReport, TriageAsset } from '@/lib/types';
import { useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';

interface TriageResultsProps {
  report: TriageReport;
}

function TriageMedia({ asset }: { asset: TriageAsset }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!asset.file) {
      setLoading(false);
      return;
    }
    // If it's already a URL, use it. Otherwise, assume it's a storage path.
    if (/^https?:\/\//.test(asset.file)) {
      setUrl(asset.file);
      setLoading(false);
      return;
    }

    getDownloadURL(ref(storage, asset.file))
      .then((downloadUrl) => {
        if (active) {
          setUrl(downloadUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching triage media:', err);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [asset.file]);

  if (loading) {
    return (
      <div className="triage-media-loading">
        <div className="mini-spinner"></div>
      </div>
    );
  }

  if (!url) {
    return <div className="triage-media-error">!</div>;
  }

  return asset.kind === 'video' ? (
    <video src={url} className="triage-media-video" preload="metadata" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={asset.file} className="triage-media-image" />
  );
}

export default function TriageResults({ report }: TriageResultsProps) {
  const { brief, assets, recommendedBundle, template } = report;

  const groupedAssets = {
    use: assets.filter((a) => a.scores.verdict === 'use'),
    enhance: assets.filter((a) => a.scores.verdict === 'enhance'),
    skip: assets.filter((a) => a.scores.verdict === 'skip'),
  };

  const briefSummary = [
    brief.businessType,
    brief.motivation,
    brief.objective,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="triage-results">
      <div className="triage-summary-bar">
        <div className="triage-brief-line">{briefSummary}</div>
        <div className="triage-date">
          Triaged {new Date(report.triagedAt).toLocaleDateString()}
        </div>
      </div>

      <div className="triage-bundle">
        <div className="bundle-header">Recommended Asset Bundle</div>
        <div className="bundle-content">
          <div className="bundle-group">
            <span className="bundle-label">Ready Now:</span>
            <div className="bundle-tags">
              {recommendedBundle.routesReady.length > 0 ? (
                recommendedBundle.routesReady.map((r) => (
                  <span key={r} className="bundle-tag tag-ready">
                    {r}
                  </span>
                ))
              ) : (
                <span className="bundle-none">None</span>
              )}
            </div>
          </div>
          <div className="bundle-group">
            <span className="bundle-label">Coming Soon:</span>
            <div className="bundle-tags">
              {recommendedBundle.routesPhase2.length > 0 ? (
                recommendedBundle.routesPhase2.map((r) => (
                  <span key={r} className="bundle-tag tag-soon">
                    {r}
                  </span>
                ))
              ) : (
                <span className="bundle-none">None</span>
              )}
            </div>
          </div>
          {template?.cadence && (
            <div className="bundle-group">
              <span className="bundle-label">Cadence:</span>
              <span className="bundle-value">{template.cadence}</span>
            </div>
          )}
        </div>
      </div>

      <div className="triage-sections">
        {(['use', 'enhance', 'skip'] as const).map((verdict) => {
          const list = groupedAssets[verdict];
          if (list.length === 0) return null;

          return (
            <div key={verdict} className={`triage-section section-${verdict}`}>
              <h3 className="triage-section-title">
                {verdict === 'use' ? 'Approved' : verdict === 'enhance' ? 'Needs Enhancement' : 'Skipped'}
                <span className="triage-count">{list.length}</span>
              </h3>
              <div className="triage-grid">
                {list.map((asset, idx) => (
                  <div key={idx} className="triage-card">
                    <div className="triage-card-media">
                      <TriageMedia asset={asset} />
                      <div className={`verdict-pill verdict-${verdict}`}>{verdict}</div>
                    </div>
                    <div className="triage-card-content">
                      <div className="triage-scores">
                        <div className="triage-score" title="Quality">
                          <span className="score-val">{asset.scores.quality ?? '-'}</span>
                          <span className="score-lab">Qual</span>
                        </div>
                        <div className="triage-score" title="Relevance">
                          <span className="score-val">{asset.scores.relevance ?? '-'}</span>
                          <span className="score-lab">Rel</span>
                        </div>
                        <div className="triage-score" title="Messaging">
                          <span className="score-val">{asset.scores.messaging ?? '-'}</span>
                          <span className="score-lab">Msg</span>
                        </div>
                        <div className="triage-score score-overall">
                          <span className="score-val">{asset.scores.overall ?? '-'}</span>
                          <span className="score-lab">Total</span>
                        </div>
                      </div>
                      <div className="triage-details">
                        <div className="triage-angle">
                          <strong>Angle:</strong> {asset.scores.captionAngle}
                        </div>
                        {asset.scores.defects.length > 0 && (
                          <div className="triage-defects">
                            <strong>Defects:</strong> {asset.scores.defects.join(', ')}
                          </div>
                        )}
                        <p className="triage-notes">{asset.scores.notes}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
