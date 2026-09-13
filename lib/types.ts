/* ============================================================
   Lumin — TypeScript Definitions
   ============================================================ */

export interface Profile {
  id: string;
  username: string;
  username_normalized: string;
  display_name: string | null;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  direct_key: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  joined_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  image_name: string | null;
  image_mime_type: string | null;
  image_size_bytes: number | null;
  created_at: string;
}

/** Conversation with joined details for the sidebar list */
export interface ConversationWithDetails {
  id: string;
  created_at: string;
  updated_at: string;
  other_user: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
  };
  last_message: {
    body: string | null;
    image_path: string | null;
    sender_id: string;
    created_at: string;
  } | null;
  unread_count: number;
  last_read_at: string | null;
}

export interface SearchResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
}
