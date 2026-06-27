'use client';

import { useState } from 'react';
import { Strategy, StrategySlot } from '@/lib/types';

interface StrategyViewProps {
  strategy: Strategy;
  // Fire one ready slot's generation (writes a generateSlot command). Optional: when absent,
  // the calendar is read-only (no Generate buttons). Provided by QueueCard with brand context.
  onGenerateSlot?: (slotN: number) => Promise<void> | void;
}

type SlotGenState = 'loading' | 'done' | 'error';

export default function StrategyView({ strategy, onGenerateSlot }: StrategyViewProps) {
  const [genState, setGenState] = useState<Record<number, SlotGenState>>({});

  const handleGenerate = async (slotN: number) => {
    if (!onGenerateSlot || genState[slotN] === 'loading') return;
    setGenState((s) => ({ ...s, [slotN]: 'loading' }));
    try {
      await onGenerateSlot(slotN);
      setGenState((s) => ({ ...s, [slotN]: 'done' }));
    } catch (e) {
      console.error('generateSlot failed:', e);
      setGenState((s) => ({ ...s, [slotN]: 'error' }));
    }
  };

  const {
    theme,
    objective,
    horizon,
    channelMix,
    pillars,
    summary,
    cadence,
    slots,
    motivation,
    suggestedMotivation,
  } = strategy;

  // Group slots by week (starting Sunday or based on the first slot's week)
  // For simplicity, we'll group by the ISO week or just chunks of 7 days if date-ordered.
  // The engine usually produces dated slots. We'll group by calendar week.
  const groupedByWeek: StrategySlot[][] = [];
  if (slots && slots.length > 0) {
    let currentWeek: StrategySlot[] = [];
    let lastWeekNum = -1;

    // Sort slots by date just in case
    const sortedSlots = [...slots].sort((a, b) => a.date.localeCompare(b.date));

    sortedSlots.forEach((slot) => {
      const d = new Date(slot.date);
      // Simple week calculation: days since epoch / 7
      // Or better: get the Sunday of that week.
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day;
      const sunday = new Date(d);
      sunday.setUTCDate(diff);
      sunday.setUTCHours(0, 0, 0, 0);
      const weekTimestamp = sunday.getTime();

      if (weekTimestamp !== lastWeekNum) {
        if (currentWeek.length > 0) groupedByWeek.push(currentWeek);
        currentWeek = [slot];
        lastWeekNum = weekTimestamp;
      } else {
        currentWeek.push(slot);
      }
    });
    if (currentWeek.length > 0) groupedByWeek.push(currentWeek);
  }

  const activeMotivation = motivation || suggestedMotivation;

  return (
    <div className="strategy-view">
      <div className="strategy-header">
        <div className="strategy-title-row">
          <h2 className="strategy-theme">{theme}</h2>
          <div className="strategy-meta-badges">
            <span className="badge-horizon">{horizon}</span>
            <span className="badge-objective">{objective}</span>
          </div>
        </div>
        {activeMotivation && (
          <p className="strategy-motivation">
            <strong>Motivation:</strong> {activeMotivation}
          </p>
        )}
        <div className="strategy-cadence-line">
          📅 {cadence.postDays.join(', ')} @ {cadence.postTimeLocal} ({cadence.timezone})
        </div>
      </div>

      <div className="strategy-summary-grid">
        <div className="summary-stat">
          <span className="stat-val">{summary.totalSlots}</span>
          <span className="stat-label">Total Posts</span>
        </div>
        <div className="summary-stat">
          <span className="stat-val">{summary.readySlots}</span>
          <span className="stat-label">Ready</span>
        </div>
        <div className="summary-stat">
          <span className="stat-val">{summary.phase2Slots}</span>
          <span className="stat-label">Phase 2</span>
        </div>
        <div className="summary-stat">
          <span className="stat-val">{summary.assetsUsed}</span>
          <span className="stat-label">Assets Used</span>
        </div>
      </div>

      <div className="strategy-details-row">
        <div className="strategy-pillars">
          <div className="detail-label">Content Pillars</div>
          <div className="pillar-tags">
            {pillars.map((p) => (
              <span key={p} className="pillar-tag">{p}</span>
            ))}
          </div>
        </div>
        <div className="strategy-channels">
          <div className="detail-label">Channel Mix</div>
          <div className="channel-mix-list">
            {Object.entries(channelMix).map(([ch, pct]) => (
              <div key={ch} className="channel-mix-item">
                <span className="channel-name">{ch}</span>
                <span className="channel-pct">{Math.round(pct * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="strategy-calendar">
        {groupedByWeek.map((week, wIdx) => (
          <div key={wIdx} className="calendar-week">
            <h3 className="week-title">Week {wIdx + 1}</h3>
            <div className="week-slots">
              {week.map((slot) => (
                <div key={slot.n} className={`slot-card status-${slot.routeStatus}`}>
                  <div className="slot-header">
                    <div className="slot-date">
                      <span className="slot-day">{slot.dayOfWeek}</span>
                      <span className="slot-date-val">{new Date(slot.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div className={`route-status-badge status-${slot.routeStatus}`}>
                      {slot.routeStatus === 'ready' ? 'Ready' : 'Coming Soon'}
                    </div>
                  </div>

                  <div className="slot-body">
                    <div className="slot-meta">
                      <span className="slot-channel">{slot.channel}</span>
                      <span className="slot-pillar">{slot.pillar}</span>
                    </div>
                    <p className="slot-hook">{slot.hook}</p>
                    <div className="slot-format">
                      {slot.route} · {slot.kind} · {slot.aspect}
                    </div>
                    {slot.sourceAsset && (
                      <div className="slot-source">
                        <strong>Source:</strong> {slot.sourceAsset}
                      </div>
                    )}
                    {onGenerateSlot && slot.routeStatus === 'ready' && (
                      <div className="slot-actions">
                        <button
                          type="button"
                          className="slot-generate-btn"
                          disabled={genState[slot.n] === 'loading'}
                          onClick={() => handleGenerate(slot.n)}
                        >
                          {genState[slot.n] === 'loading'
                            ? 'Generating…'
                            : genState[slot.n] === 'done'
                            ? 'Draft requested ✓'
                            : genState[slot.n] === 'error'
                            ? 'Failed — retry'
                            : 'Generate draft'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
