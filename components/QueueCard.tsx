'use client';

import { useState, useEffect } from 'react';
import { QueueItem, Draft, TriageReport, Strategy } from '@/lib/types';
import { fetchDraft } from '@/lib/queue';
import { approve, reject, deleteItem, requestGeneration, editCaption, editSchedule, generateSlot } from '@/lib/commands';
import SocialPreview from './SocialPreview';
import TriageResults from './TriageResults';
import StrategyView from './StrategyView';
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
  triageReport?: TriageReport;
  strategy?: Strategy;
  agencyId: string;
  brandId: string;
  uid: string;
  isSaved?: boolean;
  onToggleSave?: () => void;
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

export default function QueueCard({
  item,
  triageReport,
  strategy,
  agencyId,
  brandId,
  uid,
  isSaved = false,
  onToggleSave,
}: QueueCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [showTriage, setShowTriage] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);

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

  // Owner "Reject" = plain discard. Hard-deletes the item (engine removes it from the queue +
  // deletes the draft; the bridge mirror drops its Firestore docs + Storage media), so the card
  // vanishes once the command lands. Distinct from "Request Revisions" (keep + regenerate).
  const handleDelete = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await deleteItem(agencyId, brandId, uid, item.queueId);
      setSuccessMsg('Rejected — removing this draft from your queue…');
      setConfirmingDelete(false);
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

  // <input type="datetime-local"> works in LOCAL time; convert to/from the stored UTC ISO.
  const toLocalInputValue = (iso?: string): string => {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startEditSchedule = () => {
    setScheduleInput(toLocalInputValue(item.scheduleDate));
    setScheduleMsg(null);
    setError(null);
    setEditingSchedule(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const d = new Date(scheduleInput); // parsed as LOCAL time
    if (!scheduleInput || Number.isNaN(d.getTime())) {
      setError('Please choose a valid date and time.');
      return;
    }
    d.setSeconds(0, 0);
    const iso = d.toISOString(); // -> canonical UTC the engine stores
    setSubmitting(true);
    setError(null);
    setScheduleMsg(null);
    try {
      await editSchedule(agencyId, brandId, uid, item.queueId, iso);
      setEditingSchedule(false);
      setScheduleMsg('Date updated — applying to your scheduled post…');
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
          {onToggleSave && (
            <button
              type="button"
              className={`btn-save-toggle ${isSaved ? 'saved' : ''}`}
              onClick={onToggleSave}
              title={isSaved ? 'Remove from Saved' : 'Save for later'}
            >
              {isSaved ? '★' : '☆'}
            </button>
          )}
        </div>
      </div>

      <div className="queue-card-body">
        <h3 className="queue-card-title">{item.summary || item.action}</h3>
        {item.business && <p className="queue-card-business"><strong>Business:</strong> {item.business}</p>}
        {['social-post', 'reel', 'gbp-post'].includes(item.type) && (
          <div className="queue-card-schedule">
            {!editingSchedule ? (
              <p>
                <strong>Scheduled:</strong>{' '}
                {item.scheduleDate
                  ? new Date(item.scheduleDate).toLocaleString([], {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })
                  : 'No date yet'}{' '}
                <button type="button" className="link-button" onClick={startEditSchedule} disabled={submitting}>
                  ✏️ {item.scheduleDate ? 'change' : 'set date'}
                </button>
              </p>
            ) : (
              <form onSubmit={handleSaveSchedule} className="schedule-edit">
                <input
                  type="datetime-local"
                  value={scheduleInput}
                  onChange={(ev) => setScheduleInput(ev.target.value)}
                  disabled={submitting}
                />
                <button type="submit" disabled={submitting}>Save</button>
                <button type="button" onClick={() => setEditingSchedule(false)} disabled={submitting}>
                  Cancel
                </button>
              </form>
            )}
            {scheduleMsg && <p className="schedule-msg">{scheduleMsg}</p>}
          </div>
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

      {triageReport && (
        <div className="triage-report-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            type="button"
            className="btn-triage-toggle"
            onClick={() => {
              setShowTriage(!showTriage);
              if (!showTriage) setShowStrategy(false);
            }}
          >
            {showTriage ? 'Hide Triage Report' : 'View Triage Report'}
          </button>
          {showTriage && <TriageResults report={triageReport} />}
        </div>
      )}

      {strategy && (
        <div className="strategy-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            type="button"
            className="btn-triage-toggle"
            onClick={() => {
              setShowStrategy(!showStrategy);
              if (!showStrategy) setShowTriage(false);
            }}
          >
            {showStrategy ? 'Hide Content Strategy' : 'View Content Strategy'}
          </button>
          {showStrategy && (
            <StrategyView
              strategy={strategy}
              onGenerateSlot={async (slotN) => {
                await generateSlot(agencyId, brandId, uid, strategy.submissionId || item.queueId, slotN);
              }}
            />
          )}
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
          {confirmingDelete ? (
            <div className="delete-confirm">
              <span className="delete-confirm-text">
                Reject and delete this draft? It’s removed from your queue for good — this can’t be undone.
              </span>
              <div className="delete-confirm-actions">
                <button type="button" className="btn-delete-confirm" disabled={submitting} onClick={handleDelete}>
                  {submitting ? 'Deleting…' : 'Delete it'}
                </button>
                <button
                  type="button"
                  className="btn-cancel"
                  disabled={submitting}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : !rejecting ? (
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
              <button
                type="button"
                className="btn-delete-trigger"
                disabled={submitting}
                onClick={() => {
                  setConfirmingDelete(true);
                  setError(null);
                }}
                title="Delete this draft from the queue permanently"
              >
                Reject
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
