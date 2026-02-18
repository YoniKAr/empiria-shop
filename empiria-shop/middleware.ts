// ──────────────────────────────────────────────────
// 📁 middleware.ts — REPLACE your existing file
// Updated to skip auth for Stripe webhook route
// ──────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  // Skip auth for Stripe webhooks — they use signature verification, not cookies
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
