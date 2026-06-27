'use client';

import { useState, useEffect, useCallback } from 'react';

const SAVED_ITEMS_KEY = 'portal_saved_queue_ids';

export function useSavedItems() {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SAVED_ITEMS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedIds(new Set(parsed));
        }
      } catch (err) {
        console.error('Failed to parse saved items from localStorage:', err);
      }
    }
    setInitialized(true);
  }, []);

  // Save to localStorage whenever savedIds changes
  useEffect(() => {
    if (initialized) {
      localStorage.setItem(SAVED_ITEMS_KEY, JSON.stringify(Array.from(savedIds)));
    }
  }, [savedIds, initialized]);

  const toggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return {
    savedIds,
    toggleSave,
    initialized,
  };
}
