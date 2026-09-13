-- ============================================================
-- Lumin — Supabase Migration
-- Run this file once in the Supabase SQL Editor to set up
-- all tables, RLS policies, RPCs, indexes, storage, and realtime.
-- ============================================================

-- Enable required extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. HELPER: updated_at trigger function
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2. TABLES
-- ============================================================

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  username_normalized text not null unique,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  direct_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

-- Conversation Members
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  image_path text,
  image_name text,
  image_mime_type text,
  image_size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint message_has_content check (nullif(trim(body), '') is not null or image_path is not null)
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

create index idx_profiles_username_normalized on public.profiles (username_normalized);
create index idx_profiles_display_name on public.profiles using gin (lower(display_name) gin_trgm_ops);

create index idx_conversation_members_user_id on public.conversation_members (user_id);
create index idx_conversation_members_conversation_id on public.conversation_members (conversation_id);

create index idx_messages_conversation_created on public.messages (conversation_id, created_at);
create index idx_messages_sender_id on public.messages (sender_id);

create index idx_conversations_direct_key on public.conversations (direct_key);

-- Note: gin_trgm_ops requires pg_trgm extension; if not available, use btree
-- Enable pg_trgm for fuzzy search (optional, graceful fallback)
create extension if not exists "pg_trgm";

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

-- Profiles RLS
alter table public.profiles enable row level security;

-- Anyone signed in can view basic profile fields
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can only insert their own profile
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Users can only update their own profile
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Conversations RLS
alter table public.conversations enable row level security;

-- Users can only see conversations they are a member of
create policy "conversations_select_member"
  on public.conversations for select
  to authenticated
  using (
    exists (
      select 1 from public.conversation_members
      where conversation_members.conversation_id = conversations.id
        and conversation_members.user_id = auth.uid()
    )
  );

-- No direct insert/update/delete — use RPCs only
-- (We allow insert via RPC with security definer)

-- Conversation Members RLS
alter table public.conversation_members enable row level security;

-- Members can view membership rows of conversations they belong to
create policy "conversation_members_select"
  on public.conversation_members for select
  to authenticated
  using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = auth.uid()
    )
  );

-- Members can update only their own membership row (for last_read_at)
create policy "conversation_members_update_own"
  on public.conversation_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Messages RLS
alter table public.messages enable row level security;

-- Users can view messages in conversations they belong to
create policy "messages_select_member"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversation_members
      where conversation_members.conversation_id = messages.conversation_id
        and conversation_members.user_id = auth.uid()
    )
  );

-- Users can only insert messages as themselves, in conversations they belong to
create policy "messages_insert_member"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members
      where conversation_members.conversation_id = messages.conversation_id
        and conversation_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. SECURE RPCs
-- ============================================================

-- Create or get a direct conversation between the caller and another user
create or replace function public.create_or_get_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_small uuid;
  v_large uuid;
  v_direct_key text;
  v_conversation_id uuid;
begin
  -- Reject self-messaging
  if v_caller_id = other_user_id then
    raise exception 'Cannot create a conversation with yourself';
  end if;

  -- Verify other user exists
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  -- Sort UUIDs to build deterministic direct_key
  if v_caller_id < other_user_id then
    v_small := v_caller_id;
    v_large := other_user_id;
  else
    v_small := other_user_id;
    v_large := v_caller_id;
  end if;

  v_direct_key := v_small::text || ':' || v_large::text;

  -- Try to find existing conversation
  select id into v_conversation_id
  from public.conversations
  where direct_key = v_direct_key;

  -- If found, return it
  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  -- Create new conversation (handle concurrent race with on conflict)
  insert into public.conversations (direct_key)
  values (v_direct_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning id into v_conversation_id;

  -- Create membership rows
  insert into public.conversation_members (conversation_id, user_id)
  values (v_conversation_id, v_small), (v_conversation_id, v_large)
  on conflict do nothing;

  return v_conversation_id;
end;
$$;

-- Mark a conversation as read for the calling user
create or replace function public.mark_conversation_read(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  -- Verify membership
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = target_conversation_id
      and user_id = v_caller_id
  ) then
    raise exception 'Not a member of this conversation';
  end if;

  -- Update last_read_at
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = target_conversation_id
    and user_id = v_caller_id;
end;
$$;

-- Search profiles safely — returns only safe fields, excludes caller
create or replace function public.search_profiles(search_term text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_path text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_normalized text;
begin
  -- Require minimum 2 characters
  if length(trim(search_term)) < 2 then
    return;
  end if;

  v_normalized := lower(trim(search_term));

  return query
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_path
    from public.profiles p
    where p.id != auth.uid()
      and (
        p.username_normalized like '%' || v_normalized || '%'
        or lower(p.display_name) like '%' || v_normalized || '%'
      )
    order by
      -- Exact username match first
      case when p.username_normalized = v_normalized then 0 else 1 end,
      -- Starts-with match second
      case when p.username_normalized like v_normalized || '%' then 0 else 1 end,
      p.username_normalized
    limit 20;
end;
$$;

-- ============================================================
-- 6. STORAGE — Private chat-images bucket
-- ============================================================

-- Create the private bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Storage policies for chat-images

-- Users can upload to their own folder: <uid>/<filename>
create policy "chat_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can view images in conversations they belong to
-- We check by verifying the uploader path matches a conversation member
create policy "chat_images_select_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-images'
    and (
      -- The image belongs to the user themselves
      (storage.foldername(name))[1] = auth.uid()::text
      or
      -- The image is in a conversation the user is a member of
      exists (
        select 1 from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
        where m.image_path = name
          and cm.user_id = auth.uid()
      )
    )
  );

-- Users can only update/delete their own uploads
create policy "chat_images_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "chat_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 7. REALTIME PUBLICATION
-- ============================================================

-- Enable realtime for the required tables
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_members;

-- ============================================================
-- Migration complete.
-- Verify in the Supabase Dashboard:
--   1. Tables: profiles, conversations, conversation_members, messages
--   2. RLS is enabled on all tables
--   3. Storage bucket "chat-images" is private
--   4. Realtime: messages, conversations, conversation_members are published
-- ============================================================
