import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

type Auth = { session: Session | null; ready: boolean; userId: string | null };
const Ctx = createContext<Auth>({ session: null, ready: false, userId: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={{ session, ready, userId: session?.user.id ?? null }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
