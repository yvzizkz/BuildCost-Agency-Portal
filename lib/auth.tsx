'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './types';
import { getErrorMessage } from './utils';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  sendLink: (email: string) => Promise<void>;
  completeLink: (emailOverride?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// Thrown by completeLink when the link was opened on a different device/browser
// than where it was requested, so the email isn't in localStorage and Firebase
// requires it to finish sign-in (anti-hijack protection). The login page catches
// this to render a clean confirm field instead of a window.prompt.
export const EMAIL_REQUIRED = 'EMAIL_REQUIRED';

// Normalize so a stray capital / trailing space from a mobile keyboard can't
// cause the email to mismatch the one the link was issued for.
const normalizeEmail = (email: string) => (email || '').trim().toLowerCase();

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(userDocRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            setProfile(null);
          }
        } catch (error: unknown) {
          console.error("Error loading user profile:", getErrorMessage(error));
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const sendLink = async (email: string) => {
    const cleanEmail = normalizeEmail(email);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    const actionCodeSettings = {
      url: `${baseUrl}/login`,
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('emailForSignIn', cleanEmail);
    }
  };

  const completeLink = async (emailOverride?: string) => {
    if (typeof window === 'undefined') return;
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    // Prefer an explicitly-confirmed email, else the one we stored when the link
    // was requested on this browser. No window.prompt — the login page renders a
    // proper confirm field when this throws EMAIL_REQUIRED.
    const email = normalizeEmail(emailOverride || window.localStorage.getItem('emailForSignIn') || '');
    if (!email) throw new Error(EMAIL_REQUIRED);
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem('emailForSignIn');
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, sendLink, completeLink, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
