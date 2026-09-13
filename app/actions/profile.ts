'use server';

import { createClient } from '@/lib/supabase/server';

export async function checkUsernameAvailability(username: string) {
  const supabase = await createClient();
  const normalized = username.toLowerCase();

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username_normalized', normalized)
    .single();

  return { available: !data };
}

export async function createProfile(formData: {
  username: string;
  displayName?: string;
  avatarPath?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated' };
  }

  // Validate username format
  const usernameRegex = /^[a-zA-Z0-9_.]{3,24}$/;
  if (!usernameRegex.test(formData.username)) {
    return { error: 'Username must be 3-24 characters: letters, numbers, underscores, and periods only.' };
  }

  // Check availability
  const normalized = formData.username.toLowerCase();
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username_normalized', normalized)
    .single();

  if (existing) {
    return { error: 'Username is already taken.' };
  }

  const { error } = await supabase.from('profiles').insert({
    id: user.id,
    username: formData.username,
    username_normalized: normalized,
    display_name: formData.displayName || null,
    avatar_path: formData.avatarPath || null,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: 'Username is already taken.' };
    }
    return { error: error.message };
  }

  return { success: true };
}

export async function updateProfile(formData: {
  username?: string;
  displayName?: string;
  avatarPath?: string | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated' };
  }

  const updates: Record<string, unknown> = {};

  if (formData.username !== undefined) {
    const usernameRegex = /^[a-zA-Z0-9_.]{3,24}$/;
    if (!usernameRegex.test(formData.username)) {
      return { error: 'Username must be 3-24 characters: letters, numbers, underscores, and periods only.' };
    }

    const normalized = formData.username.toLowerCase();
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username_normalized', normalized)
      .neq('id', user.id)
      .single();

    if (existing) {
      return { error: 'Username is already taken.' };
    }

    updates.username = formData.username;
    updates.username_normalized = normalized;
  }

  if (formData.displayName !== undefined) {
    updates.display_name = formData.displayName || null;
  }

  if (formData.avatarPath !== undefined) {
    updates.avatar_path = formData.avatarPath;
  }

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id);

  if (error) {
    if (error.code === '23505') {
      return { error: 'Username is already taken.' };
    }
    return { error: error.message };
  }

  return { success: true };
}

export async function getMyProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export async function uploadAvatar(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  const file = formData.get('avatar') as File;
  if (!file) return { error: 'No file provided' };

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return { error: 'Invalid file type. Use JPG, PNG, WEBP, or GIF.' };
  }

  if (file.size > 10 * 1024 * 1024) {
    return { error: 'File must be under 10 MB.' };
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const filePath = `${user.id}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from('chat-images')
    .upload(filePath, file, {
      upsert: true,
      contentType: file.type,
    });

  if (error) return { error: error.message };

  return { path: filePath };
}
