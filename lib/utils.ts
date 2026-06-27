export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err || 'An unknown error occurred');
}

// Turn raw Firebase / upload errors into plain language a non-technical owner can
// act on. Our own validation errors (size/type) are already written for humans, so
// they pass through unchanged; only cryptic Firebase codes get rewritten.
export function friendlyError(err: unknown): string {
  const raw = getErrorMessage(err);
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const hay = `${code} ${raw}`.toLowerCase();

  if (
    hay.includes('storage/unauthorized') ||
    hay.includes('permission-denied') ||
    hay.includes('does not have permission')
  ) {
    return "You don't have permission to do that right now. If this keeps happening, let your BuildCost contact know — it's usually a quick settings fix.";
  }
  if (hay.includes('storage/canceled')) return 'Upload canceled.';
  if (hay.includes('storage/quota-exceeded')) {
    return 'Storage is full. Please contact BuildCost so we can free up space.';
  }
  if (
    hay.includes('storage/retry-limit') ||
    hay.includes('network') ||
    hay.includes('timeout') ||
    hay.includes('unavailable')
  ) {
    return 'The connection dropped before the upload finished. Check your internet and try again.';
  }
  if (hay.includes('unauthenticated') || hay.includes('storage/unauthenticated')) {
    return 'Your session expired. Please sign in again and retry.';
  }
  return raw;
}

// Human-readable file size for the intake list (MB up to 1 GB, then GB).
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
