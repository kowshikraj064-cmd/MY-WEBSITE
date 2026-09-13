# Lumin — A softer place to stay close

A premium, private real-time messenger built with Next.js App Router, React, TypeScript, and Supabase. Designed with a romantic, cinematic vine-red and black aesthetic.

## Stack

- **Frontend:** Next.js (App Router) + React + TypeScript + CSS
- **Backend:** Next.js Route Handlers & Server Actions
- **Database:** Supabase (Postgres)
- **Auth:** Supabase Auth (Google OAuth)
- **Realtime:** Supabase Realtime
- **Storage:** Supabase Storage (private bucket)
- **Hosting:** Vercel

## Project Structure

```
├── app/
│   ├── layout.tsx              # Root layout with fonts & metadata
│   ├── page.tsx                # Login page (server component)
│   ├── globals.css             # Complete design system
│   ├── components/
│   │   ├── LoginPage.tsx       # Login + profile setup overlay
│   │   └── icons.tsx           # Custom SVG icon components
│   ├── auth/
│   │   ├── callback/route.ts   # OAuth callback handler
│   │   └── auth-code-error/page.tsx
│   ├── chat/
│   │   ├── page.tsx            # Chat page (server component)
│   │   └── components/
│   │       └── ChatLayout.tsx  # Full chat UI with realtime
│   ├── actions/
│   │   ├── profile.ts          # Profile server actions
│   │   └── chat.ts             # Chat server actions
│   └── api/
│       └── signed-url/route.ts # Private image URL generator
├── lib/
│   ├── types.ts                # TypeScript definitions
│   └── supabase/
│       ├── client.ts           # Browser Supabase client
│       ├── server.ts           # Server Supabase client
│       └── middleware.ts       # Session refresh helper
├── middleware.ts               # Route protection & session refresh
├── supabase/
│   └── migration.sql           # Complete database setup
├── .env.example                # Environment variables template
└── README.md                   # This file
```

---

## Account Setup and Publishing Guide

### Step 1 — Create and configure Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project. Wait for provisioning to complete.

2. Open **Project Settings → API**. Copy:
   - **Project URL** → paste as `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`
   - **anon / public key** → paste as `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`

3. Open **SQL Editor** and paste the entire contents of `supabase/migration.sql`. Click **Run**. This creates:
   - Tables: `profiles`, `conversations`, `conversation_members`, `messages`
   - RLS policies on all tables
   - Secure RPCs: `create_or_get_direct_conversation`, `mark_conversation_read`, `search_profiles`
   - Private `chat-images` storage bucket with storage policies
   - Realtime publication for `messages`, `conversations`, `conversation_members`

4. Confirm in the dashboard:
   - **Table Editor** → all four tables exist with RLS enabled (shield icon)
   - **Storage** → `chat-images` bucket exists and is **not public**
   - **Database → Replication** (or **Realtime** settings) → `messages`, `conversations`, and `conversation_members` are listed. The migration adds them to the `supabase_realtime` publication automatically.

5. In **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** add `http://localhost:3000/auth/callback`
   - After deploying to Vercel, also add: `https://YOUR-VERCEL-DOMAIN.vercel.app/auth/callback`

### Step 2 — Configure Google authentication

1. Go to [Google Cloud Console](https://console.cloud.google.com/).

2. Create or select a project.

3. Navigate to **APIs & Services → OAuth consent screen**:
   - Configure with your app name ("Lumin"), support email, etc.
   - If in **Testing** mode, add your Google accounts as test users.

4. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**:
   - Application type: **Web application**
   - Name: e.g., "Lumin Web"

5. In Supabase, go to **Authentication → Providers → Google**:
   - Copy the **Callback URL** shown — it looks like:
     ```
     https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
     ```
   - Paste this URL into Google Cloud's **Authorized redirect URIs**
   - ⚠️ This is the **Supabase** callback URL, not the Vercel app URL

6. Copy Google's **Client ID** and **Client Secret** into the Supabase Google provider form.

7. Enable the Google provider and click **Save**.

8. Test locally. If Google reports a redirect mismatch, compare the authorized redirect URI character-for-character with the callback URL Supabase displays.

### Step 3 — Run and test locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your values:
   ```bash
   cp .env.example .env.local
   ```
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` and verify:
   - [ ] Google sign-in works
   - [ ] First-time profile setup appears
   - [ ] Username validation and availability check works
   - [ ] After setup, redirected to `/chat`
   - [ ] Using a second test account: search by username works
   - [ ] Starting a conversation creates a thread
   - [ ] Text messages send and appear in real time
   - [ ] Photo upload works (JPG/PNG/WEBP/GIF under 10 MB)
   - [ ] Unread badge appears on the sidebar
   - [ ] Sign out works
   - [ ] Unauthenticated visit to `/chat` redirects to `/`
   - [ ] Refreshing `/chat` while signed in keeps the session

### Step 4 — Publish with Vercel

1. Push your project to a GitHub repository:
   ```bash
   git add .
   git commit -m "Lumin v1"
   git push origin main
   ```

2. In [Vercel](https://vercel.com), click **Add New → Project**, import the repository. Vercel will auto-detect Next.js.

3. In **Project Settings → Environment Variables**, add:
   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key |
   | `NEXT_PUBLIC_SITE_URL` | `https://YOUR-APP.vercel.app` (no trailing slash) |

4. Deploy. Vercel's default Next.js build settings work out of the box.

5. Copy your production URL (e.g., `https://lumin-abc.vercel.app`). In Supabase:
   - **Authentication → URL Configuration → Redirect URLs**: add `https://YOUR-APP.vercel.app/auth/callback`
   - If your final custom domain differs from the initial Vercel domain, update `NEXT_PUBLIC_SITE_URL` in Vercel and redeploy.

6. Test from the production URL:
   - [ ] Google sign-in works
   - [ ] Profile setup works
   - [ ] Two-user real-time messaging works
   - [ ] Private images load for conversation members only
   - [ ] Sign out works
   - [ ] Direct navigation to `/chat` works
   - [ ] Refresh on `/chat` preserves the session

### Step 5 — Production verification

- [ ] `npm run build` completes successfully
- [ ] No credentials in Git, browser bundle, or logs
- [ ] All tables and `storage.objects` enforce RLS
- [ ] Users outside a conversation cannot access its images
- [ ] OAuth works from the production domain
- [ ] Mobile layout is usable
- [ ] Keyboard focus is visible
- [ ] `prefers-reduced-motion` is respected

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Supabase publishable / anon key |
| `NEXT_PUBLIC_SITE_URL` | Client + Server | Full application origin, no trailing slash |

Never commit real keys. No service-role key is used.

---

## License

Private project. All rights reserved.
