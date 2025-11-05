import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface User {
  id: string;
  email: string;
  company_id?: string;
  role?: string;
}

interface UserContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          setError('Error al obtener la sesión');
          return;
        }

        // If no session, just set user to null (not logged in)
        if (!session) {
          setUser(null);
          return;
        }

        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

        if (authError) {
          console.error('Error getting user:', authError);
          setError('Error al obtener el usuario');
          return;
        }

        if (authUser) {
          // Get additional user data from profiles if needed
          const { data: profileData, error: profileError } = await supabase
            .from('company_profiles')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (profileError && profileError.code !== 'PGRST116') {
            console.error('Error getting profile:', profileError);
            setError('Error al obtener el perfil');
            return;
          }

          setUser({
            id: authUser.id,
            email: authUser.email || '',
            company_id: profileData?.id || authUser.id,
            role: authUser.app_metadata?.role || 'company'
          });
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Error fetching user:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar el usuario');
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchUser();

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        fetchUser();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, error }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};