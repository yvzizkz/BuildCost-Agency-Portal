'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { getErrorMessage } from '@/lib/utils';

export default function LoginPage() {
  const { sendLink, completeLink, user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
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
          await completeLink();
        } catch (err: unknown) {
          console.error(err);
          setError(getErrorMessage(err));
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
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (loading && !sent) {
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

        {sent ? (
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
