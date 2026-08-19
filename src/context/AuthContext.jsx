import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

// =====================================================================
// Auth state.
//
// Much simpler than the Supabase-era version: that one carried a
// serialised lock, two 4-second timeout races and a cached-session
// reader, all to work around a supabase-js bug where a hung token
// refresh would wedge every subsequent query. There is no shared lock
// to orphan now — /api/auth/me is a plain request that either answers
// or fails — so all of it is gone.
//
// `profile` keeps its old shape so the six views reading it are
// unchanged. It is now sourced from the session rather than a second
// round trip, since the API already returns the account with the token.
// =====================================================================

const RECHECK_MS = 10 * 60 * 1000;

const AuthContext = createContext(null);

const toProfile = (session) => {
  const u = session?.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? null,
    username: u.username,
    full_name: u.full_name || u.username || 'User',
    role: u.role || 'creator',
    status: 'active',
  };
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((s) => {
    setSession(s ?? null);
    setTenant(s?.tenant ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      // Revalidates against the server, so a revoked or expired
      // evaluation is rejected on load rather than at the next write.
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      apply(data?.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      apply(s);
      setLoading(false);
    });

    // Re-check periodically and when the tab regains focus, so a
    // revoked or expired sandbox drops the session promptly instead of
    // waiting for the user's next write to fail.
    const recheck = async () => {
      if (document.visibilityState === 'hidden') return;
      const { data } = await supabase.auth.getSession();
      if (mounted) apply(data?.session ?? null);
    };
    const timer = setInterval(recheck, RECHECK_MS);
    document.addEventListener('visibilitychange', recheck);

    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
      sub.subscription.unsubscribe();
    };
  }, [apply]);

  const signIn = async (email, password) => {
    const res = await supabase.auth.signInWithPassword({ username: email, password });
    if (res.data?.session) apply(res.data.session);
    return res;
  };

  // Accounts are issued by Intelligent Machines, not self-registered.
  // Kept so AuthView's existing call fails with a useful message.
  const signUp = async () => supabase.auth.signUp();

  const signOut = async () => {
    await supabase.auth.signOut();
    apply(null);
  };

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    apply(data?.session ?? null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile: toProfile(session),
        tenant,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
