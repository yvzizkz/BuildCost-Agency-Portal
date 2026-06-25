'use client';

import { useState, useEffect } from 'react';
import { QueueItem, Draft } from '@/lib/types';
import { fetchDraft } from '@/lib/queue';
import { approve, reject } from '@/lib/commands';
import MediaPreview from './MediaPreview';

interface QueueCardProps {
  item: QueueItem;
  agencyId: string;
  brandId: string;
  uid: string;
}

export default function QueueCard({ item, agencyId, brandId, uid }: QueueCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (item.draftId) {
      setLoadingDraft(true);
      fetchDraft(agencyId, brandId, item.draftId)
        .then((data) => {
          setDraft(data);
          setLoadingDraft(false);
        })
        .catch((err) => {
          console.error('Error fetching draft:', err);
          setLoadingDraft(false);
        });
    }
  }, [agencyId, brandId, item.draftId]);

  const handleApprove = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await approve(agencyId, brandId, uid, item.queueId);
      setSuccessMsg('Approval command submitted successfully!');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to submit approval command.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!notes.trim()) {
      setError('Revision notes are required to reject.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await reject(agencyId, brandId, uid, item.queueId, notes);
      setSuccessMsg('Rejection command submitted successfully!');
      setRejecting(false);
      setNotes('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to submit rejection command.');
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = item.status !== 'approved' && item.status !== 'rejected';

  return (
    <div className={`queue-card status-${item.status || 'pending'}`}>
      <div className="queue-card-header">
        <div className="queue-card-meta">
          <span className="badge-type">{item.type}</span>
          {item.estMinutes && <span className="meta-time">{item.estMinutes}m est.</span>}
        </div>
        <div className="queue-card-status">
          <span className={`status-badge status-${item.status || 'pending'}`}>
            {(item.status || 'pending').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="queue-card-body">
        <h3 className="queue-card-title">{item.summary || item.action}</h3>
        {item.business && <p className="queue-card-business"><strong>Business:</strong> {item.business}</p>}
        {item.scheduleDate && (
          <p className="queue-card-schedule">
            <strong>Scheduled:</strong> {new Date(item.scheduleDate).toLocaleDateString()}
          </p>
        )}
      </div>

      {loadingDraft && (
        <div className="draft-loading">
          <div className="mini-spinner"></div>
          <span>Loading draft preview...</span>
        </div>
      )}

      {draft && (
        <div className="queue-card-draft">
          {draft.assets && draft.assets.length > 0 && (
            <div className="draft-assets-grid">
              {draft.assets.map((asset, index) => (
                <MediaPreview key={index} asset={asset} />
              ))}
            </div>
          )}

          {draft.copy && (
            <div className="draft-copy-container">
              {draft.copy.body && <p className="draft-copy-body">{draft.copy.body}</p>}
              {draft.copy.hashtags && (
                <p className="draft-copy-hashtags">
                  {Array.isArray(draft.copy.hashtags)
                    ? draft.copy.hashtags.join(' ')
                    : draft.copy.hashtags}
                </p>
              )}
              {draft.copy.cta && (
                <div className="draft-copy-cta">
                  <strong>Call to Action:</strong> {draft.copy.cta}
                </div>
              )}
            </div>
          )}

          <div className="draft-qa-badges">
            {draft.voiceCheck && (
              <div className={`qa-badge voice-check ${draft.voiceCheck.passed ? 'pass' : 'fail'}`}>
                <div className="qa-badge-title">
                  <span className="dot"></span>
                  <strong>Voice Check:</strong> {draft.voiceCheck.passed ? 'PASSED' : 'VIOLATION'}
                </div>
                {!draft.voiceCheck.passed && draft.voiceCheck.violations && (
                  <ul className="qa-list">
                    {draft.voiceCheck.violations.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {draft.mediaQA && (
              <div className={`qa-badge media-qa ${draft.mediaQA.verdict}`}>
                <div className="qa-badge-title">
                  <span className="dot"></span>
                  <strong>Media QA:</strong> {draft.mediaQA.verdict.toUpperCase()} (Score: {draft.mediaQA.score})
                </div>
                {draft.mediaQA.defects && draft.mediaQA.defects.length > 0 && (
                  <ul className="qa-list">
                    {draft.mediaQA.defects.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {successMsg && <div className="success-banner">{successMsg}</div>}

      {isActive && !successMsg && (
        <div className="queue-card-actions">
          {!rejecting ? (
            <>
              <button
                className="btn-approve"
                disabled={submitting}
                onClick={handleApprove}
              >
                Approve
              </button>
              <button
                className="btn-reject-trigger"
                disabled={submitting}
                onClick={() => {
                  setRejecting(true);
                  setError(null);
                }}
              >
                Request Revisions
              </button>
            </>
          ) : (
            <form onSubmit={handleReject} className="rejection-form">
              <textarea
                placeholder="Required: Provide feedback explaining what changes are needed..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required
                className="rejection-textarea"
                rows={3}
              />
              <div className="rejection-form-actions">
                <button
                  type="submit"
                  className="btn-reject-submit"
                  disabled={submitting || !notes.trim()}
                >
                  Submit Rejection
                </button>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setRejecting(false);
                    setNotes('');
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
