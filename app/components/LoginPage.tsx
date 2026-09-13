'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { createProfile, checkUsernameAvailability, uploadAvatar } from '@/app/actions/profile';
import { LuminLogo, GoogleIcon, CheckIcon, CameraIcon } from '@/app/components/icons';

interface LoginPageProps {
  needsSetup?: boolean;
  userId?: string;
}

export default function LoginPage({ needsSetup = false, userId }: LoginPageProps) {
  const router = useRouter();
  const [showSetup, setShowSetup] = useState(needsSetup);
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
      },
    });
  };

  // Listen for auth state changes (handles case where user signs in but setup=true in URL)
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !showSetup) {
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, showSetup]);

  // Check URL params for setup flag
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('setup') === 'true') {
        setShowSetup(true);
      }
    }
  }, []);

  return (
    <div className="login-page">
      {/* Ambient Background */}
      <div className="login-bg">
        <div className="login-glow login-glow-1" />
        <div className="login-glow login-glow-2" />
        <div className="login-glow login-glow-3" />
      </div>

      {/* Login Card */}
      <div className="login-card">
        <div className="login-logo">
          <LuminLogo size={44} />
          <span className="login-wordmark" style={{ fontFamily: 'var(--font-serif)' }}>
            Lumin
          </span>
        </div>

        <h1 className="login-headline" style={{ fontFamily: 'var(--font-serif)' }}>
          A softer place to stay close.
        </h1>

        <p className="login-subtext">
          Private conversations, held with intention.
        </p>

        <button
          className="btn btn-google"
          onClick={handleGoogleSignIn}
          disabled={loading}
          id="google-sign-in"
        >
          <GoogleIcon size={20} />
          {loading ? 'Connecting…' : 'Continue with Google'}
        </button>

        <p className="login-privacy">
          Your email stays private. Your username is how friends find you.
        </p>
      </div>

      {/* Profile Setup Overlay */}
      {showSetup && userId && (
        <ProfileSetup userId={userId} />
      )}
    </div>
  );
}

function ProfileSetup({ userId }: { userId: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const usernameRegex = /^[a-zA-Z0-9_.]{3,24}$/;

  const checkUsername = useCallback(async (value: string) => {
    if (!usernameRegex.test(value)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const { available } = await checkUsernameAvailability(value);
    setUsernameStatus(available ? 'available' : 'taken');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 24);
    setUsername(value);
    setError('');

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 3) {
      setUsernameStatus('idle');
      return;
    }

    debounceRef.current = setTimeout(() => checkUsername(value), 400);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please use JPG, PNG, WEBP, or GIF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.');
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameRegex.test(username) || usernameStatus !== 'available') return;

    setSubmitting(true);
    setError('');

    let avatarPath: string | undefined;

    if (avatarFile) {
      const formData = new FormData();
      formData.append('avatar', avatarFile);
      const result = await uploadAvatar(formData);
      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      avatarPath = result.path;
    }

    const result = await createProfile({
      username,
      displayName: displayName || undefined,
      avatarPath,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    router.push('/chat');
  };

  const monogram = username
    ? username.charAt(0).toUpperCase()
    : displayName
      ? displayName.charAt(0).toUpperCase()
      : userId.charAt(0).toUpperCase();

  const canSubmit = usernameStatus === 'available' && !submitting;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel">
        <h2 className="overlay-title" style={{ fontFamily: 'var(--font-serif)' }}>
          Make it yours.
        </h2>
        <p className="overlay-subtitle">
          Choose how you&apos;ll appear on Lumin
        </p>

        <form onSubmit={handleSubmit}>
          {/* Avatar Upload */}
          <div className="form-group">
            <div className="avatar-upload">
              <div
                className="avatar-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Upload profile photo"
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              >
                <div className="avatar avatar-xl">
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="Avatar preview" />
                  ) : (
                    monogram
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
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
                aria-label="Choose profile photo"
              />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Optional profile photo
              </span>
            </div>
          </div>

          {/* Username */}
          <div className="form-group">
            <label htmlFor="setup-username" className="input-label">Username</label>
            <input
              id="setup-username"
              className={`input ${usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'input-error' : ''}`}
              type="text"
              placeholder="your_username"
              value={username}
              onChange={handleUsernameChange}
              maxLength={24}
              autoComplete="off"
              required
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
            {usernameStatus === 'invalid' && username.length > 0 && (
              <div className="input-error-text">
                3–24 characters: letters, numbers, underscores, and periods
              </div>
            )}
          </div>

          {/* Display Name */}
          <div className="form-group">
            <label htmlFor="setup-display-name" className="input-label">Display name</label>
            <input
              id="setup-display-name"
              className="input"
              type="text"
              placeholder="Optional"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
              maxLength={40}
            />
            <div className="input-hint">How your name appears in conversations</div>
          </div>

          {error && (
            <div className="input-error-text" style={{ marginBottom: 16 }}>{error}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
            style={{ width: '100%' }}
            id="enter-lumin"
          >
            {submitting ? (
              <>
                <span className="spinner" /> Setting up…
              </>
            ) : (
              'Enter Lumin'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
