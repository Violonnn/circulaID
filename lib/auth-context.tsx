import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getCurrentUser, type UserProfile } from './auth';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  profile: UserProfile | null;
  // True while we don't yet know enough to route (booting or loading profile).
  loading: boolean;
  // True when a session exists but no users row could be loaded for it.
  profileMissing: boolean;
  // Re-fetch the signed-in user's public.users row (e.g. after editing details).
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  profileMissing: false,
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [booting, setBooting] = useState(true);

  // On boot: check for an existing persisted session before any screen shows.
  // Then subscribe so login/logout from anywhere keeps this state in sync.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Whenever the signed-in user changes, (re)load their database profile.
  useEffect(() => {
    let active = true;

    async function loadProfile() {
      // Guard: no session means nothing to load and no profile to miss.
      if (!session) {
        setProfile(null);
        setProfileMissing(false);
        return;
      }
      const next = await getCurrentUser();
      if (!active) return;
      setProfile(next);
      setProfileMissing(next === null);
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  // Keep auth tokens refreshing only while the app is in the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return supabase.auth.startAutoRefresh();
      supabase.auth.stopAutoRefresh();
    });
    return () => sub.remove();
  }, []);

  // Re-fetch the profile on demand (after the user edits their own details).
  async function refreshProfile() {
    const next = await getCurrentUser();
    setProfile(next);
    setProfileMissing(next === null);
  }

  // A session's profile is "resolved" once we either have it or know it's gone.
  const profileResolved = !session || profile !== null || profileMissing;
  const loading = booting || !profileResolved;

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileMissing, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
