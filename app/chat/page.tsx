import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ChatLayout from '@/app/chat/components/ChatLayout';
import type { Profile } from '@/lib/types';

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // Check profile exists
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    redirect('/?setup=true');
  }

  return <ChatLayout currentUser={profile as Profile} />;
}
