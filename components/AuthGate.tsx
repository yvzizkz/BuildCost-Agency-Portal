'use client';

import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user && pathname !== '/login') {
        router.push('/login');
      } else if (user && profile && pathname === '/login') {
        router.push('/');
      }
    }
  }, [user, profile, loading, pathname, router]);

  if (loading) {
    return (
      <div className="auth-loading-container">
        <div className="spinner"></div>
        <p>Loading BuildCost Portal...</p>
      </div>
    );
  }

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (!user) {
    return null; // Redirecting...
  }

  if (!profile) {
    return (
      <div className="unprovisioned-container">
        <div className="unprovisioned-card">
          <h2>Account Not Provisioned</h2>
          <p>
            Your email <strong>{user.email}</strong> is authenticated, but your profile has not been provisioned in the portal database yet.
          </p>
          <p>Please contact your administrator to set up your agency permissions.</p>
          <button className="btn-signout" onClick={signOut}>
            Sign Out & Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
