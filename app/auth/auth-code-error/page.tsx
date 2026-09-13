import Link from 'next/link';

export default function AuthCodeError() {
  return (
    <div className="auth-error">
      <h1 className="auth-error-title" style={{ fontFamily: 'var(--font-serif)' }}>
        Something went wrong
      </h1>
      <p className="auth-error-text">
        We couldn&apos;t complete the sign-in. Please try again.
      </p>
      <Link href="/" className="btn btn-primary">
        Back to Lumin
      </Link>
    </div>
  );
}
