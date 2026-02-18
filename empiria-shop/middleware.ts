import { type NextRequest, NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  // Skip auth for Stripe webhooks — they use signature verification, not cookies
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  // Only run auth0.middleware() for /auth/* routes (login, callback, logout).
  // For all other routes, pass through without session rolling — this prevents
  // the SDK from refreshing/recreating stale host-only cookies on every request.
  // getSession() still reads the shared .empiriaindia.com cookie directly.
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    return await auth0.middleware(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
