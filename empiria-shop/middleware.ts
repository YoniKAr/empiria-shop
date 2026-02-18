import { type NextRequest, NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  // Skip auth for Stripe webhooks — they use signature verification, not cookies
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  const response = await auth0.middleware(request);

  // Clear any stale host-only appSession cookie left from before AUTH0_COOKIE_DOMAIN
  // was configured. This only expires the cookie on "shop.empiriaindia.com" (no Domain
  // attribute = host-only), leaving the shared ".empiriaindia.com" cookie untouched.
  response.headers.append(
    'Set-Cookie',
    'appSession=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly'
  );

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
