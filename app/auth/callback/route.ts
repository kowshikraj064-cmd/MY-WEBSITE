import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chat';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if user has a profile (username set up)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single();

        if (profile) {
          // Existing user with profile — go to chat
          const forwardedHost = request.headers.get('x-forwarded-host');
          const isLocalEnv = process.env.NODE_ENV === 'development';

          if (isLocalEnv) {
            return NextResponse.redirect(`${origin}${next}`);
          } else if (forwardedHost) {
            return NextResponse.redirect(`https://${forwardedHost}${next}`);
          } else {
            return NextResponse.redirect(`${origin}${next}`);
          }
        } else {
          // New user — send to home for profile setup
          const forwardedHost = request.headers.get('x-forwarded-host');
          const isLocalEnv = process.env.NODE_ENV === 'development';

          if (isLocalEnv) {
            return NextResponse.redirect(`${origin}/?setup=true`);
          } else if (forwardedHost) {
            return NextResponse.redirect(`https://${forwardedHost}/?setup=true`);
          } else {
            return NextResponse.redirect(`${origin}/?setup=true`);
          }
        }
      }
    }
  }

  // OAuth error — redirect home
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
