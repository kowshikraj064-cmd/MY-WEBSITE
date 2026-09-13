import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import LoginPage from '@/app/components/LoginPage';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Check if user has a profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();

    if (profile) {
      redirect('/chat');
    }

    // User is authenticated but needs profile setup
    return <LoginPage needsSetup userId={user.id} />;
  }

  return <LoginPage />;
}
