'use server';

import { createClient } from '@/lib/supabase/server';

export async function searchProfiles(searchTerm: string) {
  const supabase = await createClient();

  if (searchTerm.trim().length < 2) return [];

  const { data, error } = await supabase.rpc('search_profiles', {
    search_term: searchTerm,
  });

  if (error) {
    console.error('Search error:', error);
    return [];
  }

  return data || [];
}

export async function createOrGetConversation(otherUserId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('create_or_get_direct_conversation', {
    other_user_id: otherUserId,
  });

  if (error) {
    console.error('Create conversation error:', error);
    return { error: error.message };
  }

  return { conversationId: data };
}

export async function getConversations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return [];

  // Get all conversations the user is a member of
  const { data: memberships } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id);

  if (!memberships || memberships.length === 0) return [];

  const conversationIds = memberships.map((m) => m.conversation_id);

  // Get conversations
  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .in('id', conversationIds)
    .order('updated_at', { ascending: false });

  if (!conversations) return [];

  // Get all members for these conversations (to find the other user)
  const { data: allMembers } = await supabase
    .from('conversation_members')
    .select('conversation_id, user_id')
    .in('conversation_id', conversationIds);

  // Get the other user's profiles
  const otherUserIds = (allMembers || [])
    .filter((m) => m.user_id !== user.id)
    .map((m) => m.user_id);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path')
    .in('id', otherUserIds);

  // Get last message for each conversation
  const results = await Promise.all(
    conversations.map(async (conv) => {
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('body, image_path, sender_id, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const membership = memberships.find((m) => m.conversation_id === conv.id);
      const otherMember = (allMembers || []).find(
        (m) => m.conversation_id === conv.id && m.user_id !== user.id
      );
      const otherProfile = (profiles || []).find(
        (p) => p.id === otherMember?.user_id
      );

      // Count unread messages
      let unreadCount = 0;
      if (lastMsg) {
        const lastReadAt = membership?.last_read_at;
        if (lastReadAt) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', user.id)
            .gt('created_at', lastReadAt);
          unreadCount = count || 0;
        } else {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', user.id);
          unreadCount = count || 0;
        }
      }

      return {
        id: conv.id,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        other_user: otherProfile
          ? {
              id: otherProfile.id,
              username: otherProfile.username,
              display_name: otherProfile.display_name,
              avatar_path: otherProfile.avatar_path,
            }
          : { id: '', username: 'Unknown', display_name: null, avatar_path: null },
        last_message: lastMsg || null,
        unread_count: unreadCount,
        last_read_at: membership?.last_read_at || null,
      };
    })
  );

  // Sort by last message time or conversation creation
  results.sort((a, b) => {
    const aTime = a.last_message?.created_at || a.created_at;
    const bTime = b.last_message?.created_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return results;
}

export async function getMessages(conversationId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Get messages error:', error);
    return [];
  }

  return data || [];
}

export async function sendMessage(data: {
  conversationId: string;
  body?: string;
  imagePath?: string;
  imageName?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.from('messages').insert({
    conversation_id: data.conversationId,
    sender_id: user.id,
    body: data.body || null,
    image_path: data.imagePath || null,
    image_name: data.imageName || null,
    image_mime_type: data.imageMimeType || null,
    image_size_bytes: data.imageSizeBytes || null,
  });

  if (error) {
    console.error('Send message error:', error);
    return { error: error.message };
  }

  // Update conversation's updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', data.conversationId);

  return { success: true };
}

export async function markConversationRead(conversationId: string) {
  const supabase = await createClient();

  const { error } = await supabase.rpc('mark_conversation_read', {
    target_conversation_id: conversationId,
  });

  if (error) {
    console.error('Mark read error:', error);
  }
}

export async function uploadChatImage(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  const file = formData.get('image') as File;
  if (!file) return { error: 'No file provided' };

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return { error: 'Invalid file type. Use JPG, PNG, WEBP, or GIF.' };
  }

  if (file.size > 10 * 1024 * 1024) {
    return { error: 'File must be under 10 MB.' };
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `${user.id}/${fileName}`;

  const { error } = await supabase.storage
    .from('chat-images')
    .upload(filePath, file, {
      contentType: file.type,
    });

  if (error) return { error: error.message };

  return {
    path: filePath,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}
