'use client';

import { useState, useEffect } from 'react';
import { QueueItem, Draft } from '@/lib/types';
import { fetchDraft } from '@/lib/queue';
import { approve, reject, requestGeneration, editCaption } from '@/lib/commands';
import SocialPreview from './SocialPreview';
import { friendlyError } from '@/lib/utils';

// Plain-language status labels for non-technical owners. The CSS class still keys
// off the raw status; only the visible text is humanized.
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  'needs-human': 'Needs your review',
  'awaiting-approval': 'Awaiting your approval',
  approved: 'Approved',
  rejected: 'Revisions requested',
};

function statusLabel(status?: string): string {
  const key = status || 'pending';
  return (
    STATUS_LABELS[key] ||
    key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface QueueCardProps {
  item: QueueItem;
  agencyId: string;
  brandId: string;
  uid: string;
}

// The mockup formats an owner can fan out for a submission's project. Values MUST match the
// studio `--media` vocabulary allow-listed in bridge/dispatch.mjs (SOCIAL_MEDIA).
const MOCKUP_FORMATS: { value: string; label: string }[] = [
  { value: 'single', label: 'Single image' },
  { value: 'collage:before-after', label: 'Before / After' },
  { value: 'collage:process-journey', label: 'Process journey' },
  { value: 'collage:feature-trio', label: 'Feature trio' },
  { value: 'collage:grid-2x2', label: '2×2 grid' },
  { value: 'collage:reveal', label: 'Reveal' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'vision', label: 'Concept render' },
];

export default function QueueCard({ item, agencyId, brandId, uid }: QueueCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([
    'single',
    'collage:before-after',
    'carousel',
  ]);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editCta, setEditCta] = useState('');
  const [editMsg, setEditMsg] = useState<string | null>(null);

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
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
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
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFormat = (value: string) => {
    setSelectedFormats((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleGenerateMockups = async () => {
    if (generating || !item.projectId || selectedFormats.length === 0) return;
    setGenerating(true);
    setError(null);
    setGenMsg(null);
    try {
      // One command per format — each becomes its own draft + review card (the bridge maps
      // it to studio --project <id> --media <fmt> --slot <fmt>, draft-only).
      await Promise.all(
        selectedFormats.map((media) =>
          requestGeneration(agencyId, brandId, uid, 'social', {
            project: item.projectId,
            media,
          })
        )
      );
      setGenMsg(
        `Queued ${selectedFormats.length} mockup${selectedFormats.length > 1 ? 's' : ''} — drafts will appear here shortly.`
      );
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  };

  const startEdit = () => {
    const c = draft?.copy || {};
    setEditBody(typeof c.body === 'string' ? c.body : '');
    const h = c.hashtags;
    setEditHashtags(Array.isArray(h) ? h.join(' ') : typeof h === 'string' ? h : '');
    setEditCta(typeof c.cta === 'string' ? c.cta : '');
    setEditMsg(null);
    setError(null);
    setEditing(true);
  };

  const handleSaveCaption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setEditMsg(null);
    try {
      await editCaption(agencyId, brandId, uid, item.queueId, {
        body: editBody,
        hashtags: editHashtags,
        cta: editCta,
      });
      // Optimistic: reflect the edit in the preview immediately. The engine persists the
      // change and refreshes the GHL draft, then re-mirrors the authoritative copy.
      setDraft((prev) =>
        prev ? { ...prev, copy: { ...prev.copy, body: editBody, hashtags: editHashtags, cta: editCta } } : prev
      );
      setEditing(false);
      setEditMsg('Caption saved — updating your scheduled post…');
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const hasCaption =
    !!draft?.copy &&
    (typeof draft.copy.body === 'string' ||
      typeof draft.copy.cta === 'string' ||
      draft.copy.hashtags !== undefined);

  const canGenerateMockups = item.type === 'intake' && !!item.projectId;
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
            {statusLabel(item.status)}
          </span>
          {item.ghlStatus && (
            <span className="status-badge ghl-draft" title="Pushed to the GHL Social Planner as a draft">
              ✓ GHL {item.ghlStatus}
            </span>
          )}
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

      {canGenerateMockups && (
        <div className="queue-card-generate">
          <p className="generate-title"><strong>Generate mockups</strong> for this submission</p>
          <div className="generate-formats">
            {MOCKUP_FORMATS.map((f) => (
              <label key={f.value} className="generate-format">
                <input
                  type="checkbox"
                  checked={selectedFormats.includes(f.value)}
                  onChange={() => toggleFormat(f.value)}
                  disabled={generating}
                />
                {f.label}
              </label>
            ))}
          </div>
          <button
            className="btn-generate"
            disabled={generating || selectedFormats.length === 0}
            onClick={handleGenerateMockups}
          >
            {generating
              ? 'Queueing…'
              : `Generate ${selectedFormats.length} mockup${selectedFormats.length === 1 ? '' : 's'}`}
          </button>
          {genMsg && <div className="success-banner">{genMsg}</div>}
        </div>
      )}

      {loadingDraft && (
        <div className="draft-loading">
          <div className="mini-spinner"></div>
          <span>Loading draft preview...</span>
        </div>
      )}

      {draft && (
        <div className="queue-card-draft">
          {draft.assets && draft.assets.length > 0 ? (
            <SocialPreview item={item} draft={draft} brandName={item.business} />
          ) : (
            draft.copy && (
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
            )
          )}

          {hasCaption && (
            <div className="caption-edit">
              {!editing ? (
                <button type="button" className="btn-edit-caption" onClick={startEdit}>
                  ✏️ Edit caption
                </button>
              ) : (
                <form onSubmit={handleSaveCaption} className="caption-edit-form">
                  <label className="caption-edit-label">Caption</label>
                  <textarea
                    className="caption-edit-textarea"
                    rows={5}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="Write the caption…"
                  />
                  <label className="caption-edit-label">Hashtags</label>
                  <input
                    className="caption-edit-input"
                    value={editHashtags}
                    onChange={(e) => setEditHashtags(e.target.value)}
                    placeholder="#Example #Tags"
                  />
                  <label className="caption-edit-label">Call to action</label>
                  <input
                    className="caption-edit-input"
                    value={editCta}
                    onChange={(e) => setEditCta(e.target.value)}
                    placeholder="Book a free consultation"
                  />
                  <div className="caption-edit-actions">
                    <button type="submit" className="btn-approve" disabled={submitting}>
                      {submitting ? 'Saving…' : 'Save caption'}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => setEditing(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {editMsg && <div className="success-banner">{editMsg}</div>}
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
