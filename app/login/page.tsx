'use client';

import { useState, useEffect } from 'react';
import { useAuth, EMAIL_REQUIRED } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { getErrorMessage } from '@/lib/utils';

// Turn raw Firebase auth codes into something an owner can act on.
function friendlyAuthError(err: unknown): string {
  const msg = getErrorMessage(err);
  if (msg.includes('auth/invalid-action-code') || msg.includes('invalid-action-code')) {
    return 'This sign-in link has expired or was already used. Please request a new one below.';
  }
  if (msg.includes('auth/invalid-email')) {
    return "That doesn't look like a valid email address. Please re-enter it.";
  }
  return msg;
}

export default function LoginPage() {
  const { sendLink, completeLink, user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (user && profile) {
      router.push('/');
    }
  }, [user, profile, router]);

  useEffect(() => {
    const handleComplete = async () => {
      if (typeof window !== 'undefined' && window.location.href.includes('apiKey=')) {
        setLoading(true);
        setError(null);
        try {
          // Auto-completes when the link is opened in the same browser it was
          // requested from (email is in localStorage) — no re-entry needed.
          await completeLink();
        } catch (err: unknown) {
          if (err instanceof Error && err.message === EMAIL_REQUIRED) {
            // Opened on a different device/browser: Firebase requires the email
            // to finish (anti-hijack). Show a clean confirm field, not an error.
            setNeedEmail(true);
          } else {
            console.error(err);
            setError(friendlyAuthError(err));
          }
          setLoading(false);
        }
      }
    };
    handleComplete();
  }, [completeLink]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      await sendLink(email);
      setSent(true);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      await completeLink(email);
      // Success → onAuthStateChanged fires and the redirect effect takes over.
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyAuthError(err));
      setLoading(false);
    }
  };

  if (loading && !sent && !needEmail) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="spinner"></div>
          <p>Verifying sign-in link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">BuildCost Portal</h2>
        <p className="login-desc">Sign in passwordless via email link</p>

        {error && <div className="error-banner" style={{ marginBottom: '1.5rem' }}>{error}</div>}

        {needEmail ? (
          <form onSubmit={handleConfirm} className="login-form">
            <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              To finish signing in on this device, confirm the email this link was sent to.
            </p>
            <div className="form-group">
              <label htmlFor="email-input" className="form-label">Email Address</label>
              <input
                id="email-input"
                type="email"
                required
                autoFocus
                placeholder="e.g. owner@brand.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Signing in...' : 'Confirm & Sign In'}
            </button>
          </form>
        ) : sent ? (
          <div className="success-banner">
            <p>Magic link sent to <strong>{email}</strong>!</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
              Please check your inbox and click the link to log in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email-input" className="form-label">Email Address</label>
              <input
                id="email-input"
                type="email"
                required
                placeholder="e.g. owner@brand.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Sending Link...' : 'Email Login Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
