'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  getConversations,
  getMessages,
  searchProfiles,
  createOrGetConversation,
  sendMessage,
  markConversationRead,
  uploadChatImage,
} from '@/app/actions/chat';
import { signOut, updateProfile, uploadAvatar, checkUsernameAvailability } from '@/app/actions/profile';
import {
  LuminLogo,
  SearchIcon,
  SendIcon,
  CameraIcon,
  CloseIcon,
  BackIcon,
  SettingsIcon,
  SignOutIcon,
  CheckIcon,
  MessageIcon,
  ImageIcon,
} from '@/app/components/icons';
import type { Profile, Message, ConversationWithDetails, SearchResult } from '@/lib/types';

interface ChatLayoutProps {
  currentUser: Profile;
}

export default function ChatLayout({ currentUser }: ChatLayoutProps) {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationWithDetails | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showLightbox, setShowLightbox] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<{
    file: File;
    preview: string;
    uploading: boolean;
    path?: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  } | null>(null);
  const [profile, setProfile] = useState<Profile>(currentUser);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const conversationsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const data = await getConversations();
    setConversations(data as ConversationWithDetails[]);
  }, []);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConversation) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      const data = await getMessages(activeConversation.id);
      setMessages(data as Message[]);
      scrollToBottom();
      // Mark as read
      await markConversationRead(activeConversation.id);
      loadConversations();
    };

    loadMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.id]);

  // Get signed URL for an image
  const getImageUrl = useCallback(async (path: string) => {
    if (imageUrls[path]) return imageUrls[path];

    try {
      const res = await fetch(`/api/signed-url?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const { url } = await res.json();
        setImageUrls(prev => ({ ...prev, [path]: url }));
        return url;
      }
    } catch (e) {
      console.error('Failed to get signed URL:', e);
    }
    return null;
  }, [imageUrls]);

  // Realtime: subscribe to messages in active conversation
  useEffect(() => {
    if (!activeConversation) return;

    // Clean up previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`messages:${activeConversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversation.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.find(m => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          scrollToBottom();

          // Mark as read if not from self
          if (newMessage.sender_id !== profile.id) {
            markConversationRead(activeConversation.id);
          }
          // Refresh conversations for sidebar
          loadConversations();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          setIsReconnecting(true);
        }
        if (status === 'SUBSCRIBED') {
          setIsReconnecting(false);
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.id, profile.id]);

  // Realtime: subscribe to conversation updates (new conversations, new messages for sidebar)
  useEffect(() => {
    if (conversationsChannelRef.current) {
      supabase.removeChannel(conversationsChannelRef.current);
    }

    const channel = supabase
      .channel('conversations-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
        },
        () => {
          loadConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_members',
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    conversationsChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }

    setShowSearch(true);
    setSearchLoading(true);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = setTimeout(async () => {
      const results = await searchProfiles(query);
      setSearchResults(results as SearchResult[]);
      setSearchLoading(false);
    }, 300);
  }, []);

  // Start conversation from search
  const handleStartConversation = useCallback(async (otherUser: SearchResult) => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);

    const result = await createOrGetConversation(otherUser.id);
    if (result.error) {
      console.error(result.error);
      return;
    }

    await loadConversations();

    // Find or create the conversation in the list
    const convId = result.conversationId;
    setActiveConversation({
      id: convId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      other_user: {
        id: otherUser.id,
        username: otherUser.username,
        display_name: otherUser.display_name,
        avatar_path: otherUser.avatar_path,
      },
      last_message: null,
      unread_count: 0,
      last_read_at: null,
    });
    setMobileShowChat(true);
  }, [loadConversations]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!activeConversation) return;

    const text = messageText.trim();
    const image = uploadingImage;

    if (!text && !image?.path) return;

    setMessageText('');
    setUploadingImage(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await sendMessage({
      conversationId: activeConversation.id,
      body: text || undefined,
      imagePath: image?.path || undefined,
      imageName: image?.name || undefined,
      imageMimeType: image?.mimeType || undefined,
      imageSizeBytes: image?.sizeBytes || undefined,
    });
  }, [activeConversation, messageText, uploadingImage]);

  // Handle textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  // Image upload
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) return;
    if (file.size > 10 * 1024 * 1024) return;

    const preview = URL.createObjectURL(file);
    setUploadingImage({ file, preview, uploading: true });

    const formData = new FormData();
    formData.append('image', file);
    const result = await uploadChatImage(formData);

    if (result.error) {
      setUploadingImage(null);
      URL.revokeObjectURL(preview);
      return;
    }

    setUploadingImage({
      file,
      preview,
      uploading: false,
      path: result.path,
      name: result.name,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
    });

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (minutes < 10080) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatMessageTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  // Group messages by date
  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Sign out
  const handleSignOut = async () => {
    // Clean up channels
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (conversationsChannelRef.current) supabase.removeChannel(conversationsChannelRef.current);
    await signOut();
    router.push('/');
    router.refresh();
  };

  // Get avatar monogram
  const getMonogram = (displayName: string | null, username: string) => {
    if (displayName) return displayName.charAt(0).toUpperCase();
    return username.charAt(0).toUpperCase();
  };

  const canSend = messageText.trim().length > 0 || (uploadingImage && !uploadingImage.uploading && uploadingImage.path);

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${mobileShowChat ? 'hidden-mobile' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <LuminLogo size={28} />
            <span className="sidebar-wordmark" style={{ fontFamily: 'var(--font-serif)' }}>
              Lumin
            </span>
          </div>

          <div className="search-wrapper">
            <SearchIcon size={16} className="search-icon" />
            <input
              className="search-input"
              type="text"
              placeholder="Find someone by @username"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => { if (searchQuery.length >= 2) setShowSearch(true); }}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              aria-label="Search for users"
              id="user-search"
            />

            {showSearch && (
              <div className="search-results" role="listbox" aria-label="Search results">
                {searchLoading ? (
                  <div className="search-loading">
                    <span className="loading-dots">
                      <span /><span /><span />
                    </span>
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="search-result-item"
                      role="option"
                      aria-selected={false}
                      onClick={() => handleStartConversation(user)}
                    >
                      <div className="avatar avatar-sm">
                        {user.avatar_path ? (
                          <AvatarImage path={user.avatar_path} alt={user.username} />
                        ) : (
                          getMonogram(user.display_name, user.username)
                        )}
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-name">
                          {user.display_name || user.username}
                        </div>
                        <div className="search-result-username">@{user.username}</div>
                      </div>
                      <button
                        className="search-result-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartConversation(user);
                        }}
                        aria-label={`Message ${user.username}`}
                      >
                        Message
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="search-empty">
                    No one found matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Conversation List */}
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="conversation-empty">
              <div className="conversation-empty-title">No conversations yet</div>
              <div className="conversation-empty-text">
                Search for someone by username to start a conversation.
              </div>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${activeConversation?.id === conv.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveConversation(conv);
                  setMobileShowChat(true);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Conversation with ${conv.other_user.display_name || conv.other_user.username}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveConversation(conv);
                    setMobileShowChat(true);
                  }
                }}
              >
                <div className="avatar">
                  {conv.other_user.avatar_path ? (
                    <AvatarImage path={conv.other_user.avatar_path} alt={conv.other_user.username} />
                  ) : (
                    getMonogram(conv.other_user.display_name, conv.other_user.username)
                  )}
                </div>
                <div className="conversation-info">
                  <div className="conversation-header-row">
                    <span className="conversation-name">
                      {conv.other_user.display_name || conv.other_user.username}
                    </span>
                    {conv.last_message && (
                      <span className="conversation-time">
                        {formatTime(conv.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="conversation-preview-row">
                    <span className={`conversation-preview ${conv.unread_count > 0 ? 'has-unread' : ''}`}>
                      {conv.last_message
                        ? conv.last_message.image_path
                          ? '📷 Photo'
                          : conv.last_message.body || ''
                        : 'Start a conversation'}
                    </span>
                    {conv.unread_count > 0 && (
                      <span className="badge">{conv.unread_count > 99 ? '99+' : conv.unread_count}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="avatar avatar-sm">
            {profile.avatar_path ? (
              <AvatarImage path={profile.avatar_path} alt={profile.username} />
            ) : (
              getMonogram(profile.display_name, profile.username)
            )}
          </div>
          <div className="sidebar-footer-info">
            <div className="sidebar-footer-name">{profile.display_name || profile.username}</div>
            <div className="sidebar-footer-username">@{profile.username}</div>
          </div>
          <button
            className="btn-icon"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            id="settings-btn"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        {isReconnecting && (
          <div className="reconnecting-banner">
            <span className="spinner" style={{ width: 14, height: 14 }} />
            Reconnecting…
          </div>
        )}

        {!activeConversation ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <MessageIcon size={48} color="var(--wine)" />
            </div>
            <h2
              className="chat-empty-title"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Some conversations deserve a beautiful beginning.
            </h2>
            <p className="chat-empty-subtitle">
              Find someone by username to start.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="chat-header">
              <button
                className="btn-icon chat-header-back"
                onClick={() => {
                  setMobileShowChat(false);
                  setActiveConversation(null);
                }}
                aria-label="Back to conversations"
              >
                <BackIcon size={20} />
              </button>
              <div className="avatar avatar-sm">
                {activeConversation.other_user.avatar_path ? (
                  <AvatarImage
                    path={activeConversation.other_user.avatar_path}
                    alt={activeConversation.other_user.username}
                  />
                ) : (
                  getMonogram(
                    activeConversation.other_user.display_name,
                    activeConversation.other_user.username
                  )
                )}
              </div>
              <div className="chat-header-info">
                <div className="chat-header-name">
                  {activeConversation.other_user.display_name ||
                    activeConversation.other_user.username}
                </div>
                <div className="chat-header-username">
                  @{activeConversation.other_user.username}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages-area">
              {messages.length === 0 ? (
                <div className="chat-empty-state" style={{ opacity: 0.6 }}>
                  <p
                    className="chat-empty-title"
                    style={{ fontSize: 16, fontFamily: 'var(--font-serif)' }}
                  >
                    This is the beginning of your conversation.
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => {
                    const prevMsg = messages[idx - 1];
                    const showDate =
                      !prevMsg ||
                      getDateLabel(msg.created_at) !== getDateLabel(prevMsg.created_at);
                    const isOutgoing = msg.sender_id === profile.id;

                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div className="date-separator">
                            <div className="date-separator-line" />
                            <span className="date-separator-text">
                              {getDateLabel(msg.created_at)}
                            </span>
                            <div className="date-separator-line" />
                          </div>
                        )}
                        <div className={`message-row ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                          <div className={`message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                            {msg.image_path && (
                              <MessageImage
                                path={msg.image_path}
                                alt={msg.image_name || 'Image'}
                                getImageUrl={getImageUrl}
                                onOpen={(url) => setShowLightbox(url)}
                              />
                            )}
                            {msg.body && <div className="message-text">{msg.body}</div>}
                            <div className="message-meta">
                              <span className="message-time">
                                {formatMessageTime(msg.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="composer">
              <button
                className="btn-icon"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach photo"
                id="attach-photo"
              >
                <CameraIcon size={20} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
                aria-label="Choose photo to send"
              />

              <div className="composer-input-wrapper">
                {uploadingImage && (
                  <div className="composer-upload-state">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={uploadingImage.preview}
                      alt="Upload preview"
                      className="composer-upload-preview"
                    />
                    <div className="composer-upload-info">
                      <div className="composer-upload-name">{uploadingImage.file.name}</div>
                      <div className="composer-upload-status">
                        {uploadingImage.uploading ? (
                          <>
                            <span className="spinner" style={{ width: 10, height: 10 }} />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <CheckIcon size={12} color="var(--rose)" />
                            Ready to send
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        URL.revokeObjectURL(uploadingImage.preview);
                        setUploadingImage(null);
                      }}
                      aria-label="Remove photo"
                      style={{ width: 28, height: 28 }}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="composer-textarea"
                  placeholder="Write a message…"
                  value={messageText}
                  onChange={handleTextareaChange}
                  onKeyDown={handleTextareaKeyDown}
                  rows={1}
                  aria-label="Message"
                  id="message-input"
                />
              </div>

              <button
                className="btn-send"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                id="send-message"
              >
                <SendIcon size={18} color="white" />
              </button>
            </div>
          </>
        )}
      </main>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          profile={profile}
          onClose={() => setShowSettings(false)}
          onUpdate={(updated) => setProfile(updated)}
          onSignOut={handleSignOut}
        />
      )}

      {/* Photo Lightbox */}
      {showLightbox && (
        <div
          className="lightbox"
          onClick={() => setShowLightbox(null)}
          role="dialog"
          aria-label="Image viewer"
        >
          <button
            className="lightbox-close"
            onClick={() => setShowLightbox(null)}
            aria-label="Close image"
          >
            <CloseIcon size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={showLightbox}
            alt="Full size"
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function AvatarImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadUrl = async () => {
      try {
        const res = await fetch(`/api/signed-url?path=${encodeURIComponent(path)}`);
        if (res.ok && !cancelled) {
          const { url: signedUrl } = await res.json();
          setUrl(signedUrl);
        }
      } catch {
        // Fail silently — monogram will show
      }
    };
    loadUrl();
    return () => { cancelled = true; };
  }, [path]);

  if (!url) return null;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function MessageImage({
  path,
  alt,
  getImageUrl,
  onOpen,
}: {
  path: string;
  alt: string;
  getImageUrl: (path: string) => Promise<string | null>;
  onOpen: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const signedUrl = await getImageUrl(path);
      if (!cancelled) {
        setUrl(signedUrl);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [path, getImageUrl]);

  if (loading) {
    return (
      <div className="message-image-loading">
        <ImageIcon size={24} color="var(--text-dim)" />
      </div>
    );
  }

  if (!url) return null;

  return (
    <div
      className="message-image-container"
      onClick={() => onOpen(url)}
      role="button"
      tabIndex={0}
      aria-label={`View ${alt}`}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(url); }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="message-image" />
    </div>
  );
}

function SettingsPanel({
  profile,
  onClose,
  onUpdate,
  onSignOut,
}: {
  profile: Profile;
  onClose: () => void;
  onUpdate: (profile: Profile) => void;
  onSignOut: () => void;
}) {
  const [username, setUsername] = useState(profile.username);
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const usernameRegex = /^[a-zA-Z0-9_.]{3,24}$/;

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 24);
    setUsername(value);
    setError('');
    setSuccess(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.toLowerCase() === profile.username_normalized) {
      setUsernameStatus('idle');
      return;
    }

    if (!usernameRegex.test(value)) {
      setUsernameStatus(value.length > 0 ? 'invalid' : 'idle');
      return;
    }

    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const { available } = await checkUsernameAvailability(value);
      setUsernameStatus(available ? 'available' : 'taken');
    }, 400);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) return;

    const formData = new FormData();
    formData.append('avatar', file);
    const result = await uploadAvatar(formData);

    if (result.path) {
      const updateResult = await updateProfile({ avatarPath: result.path });
      if (updateResult.success) {
        onUpdate({ ...profile, avatar_path: result.path });
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);

    const updates: { username?: string; displayName?: string } = {};

    if (username !== profile.username) {
      if (!usernameRegex.test(username) || usernameStatus === 'taken') {
        setError('Please choose a valid available username.');
        setSaving(false);
        return;
      }
      updates.username = username;
    }

    if (displayName !== (profile.display_name || '')) {
      updates.displayName = displayName;
    }

    if (Object.keys(updates).length === 0) {
      setSaving(false);
      return;
    }

    const result = await updateProfile(updates);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      onUpdate({
        ...profile,
        username: updates.username || profile.username,
        username_normalized: updates.username?.toLowerCase() || profile.username_normalized,
        display_name: updates.displayName !== undefined ? updates.displayName || null : profile.display_name,
      });
    }

    setSaving(false);
  };

  const hasChanges = username !== profile.username || displayName !== (profile.display_name || '');
  const canSave =
    hasChanges &&
    !saving &&
    (username === profile.username || usernameStatus === 'available');

  return (
    <div className="settings-panel">
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-content">
        <div className="settings-header">
          <h2 className="settings-title" style={{ fontFamily: 'var(--font-serif)' }}>
            Profile & settings
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close settings">
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Avatar */}
        <div className="form-group">
          <div className="avatar-upload">
            <div
              className="avatar-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Change profile photo"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <div className="avatar avatar-xl">
                {profile.avatar_path ? (
                  <AvatarImage path={profile.avatar_path} alt={profile.username} />
                ) : (
                  (profile.display_name || profile.username).charAt(0).toUpperCase()
                )}
                <div className="avatar-upload-overlay">
                  <CameraIcon size={24} color="white" />
                </div>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarUpload}
              style={{ display: 'none' }}
              aria-label="Choose new profile photo"
            />
          </div>
        </div>

        {/* Username */}
        <div className="form-group">
          <label htmlFor="settings-username" className="input-label">Username</label>
          <input
            id="settings-username"
            className={`input ${usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'input-error' : ''}`}
            type="text"
            value={username}
            onChange={handleUsernameChange}
            maxLength={24}
            autoComplete="off"
          />
          {username.length >= 3 && (
            <div className="username-preview">@{username}</div>
          )}
          {usernameStatus === 'checking' && (
            <div className="input-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="spinner" style={{ width: 12, height: 12 }} /> Checking…
            </div>
          )}
          {usernameStatus === 'available' && (
            <div className="input-success">
              <CheckIcon size={14} color="#4ade80" /> Available
            </div>
          )}
          {usernameStatus === 'taken' && (
            <div className="input-error-text">This username is taken</div>
          )}
        </div>

        {/* Display Name */}
        <div className="form-group">
          <label htmlFor="settings-display-name" className="input-label">Display name</label>
          <input
            id="settings-display-name"
            className="input"
            type="text"
            placeholder="Optional"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value.slice(0, 40));
              setSuccess(false);
            }}
            maxLength={40}
          />
        </div>

        {error && <div className="input-error-text" style={{ marginBottom: 16 }}>{error}</div>}
        {success && (
          <div className="input-success" style={{ marginBottom: 16 }}>
            <CheckIcon size={14} color="#4ade80" /> Changes saved
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!canSave}
          style={{ width: '100%' }}
          id="save-profile"
        >
          {saving ? (
            <>
              <span className="spinner" /> Saving…
            </>
          ) : (
            'Save changes'
          )}
        </button>

        <div className="settings-divider" />

        <button className="settings-signout" onClick={onSignOut} id="sign-out">
          <SignOutIcon size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
