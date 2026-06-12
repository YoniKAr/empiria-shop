import { Auth0Client } from '@auth0/nextjs-auth0/server';


// One env drives the session-cookie domain: NEXT_PUBLIC_COOKIE_DOMAIN (shared
// with client-side cookie code via lib/urls) with AUTH0_COOKIE_DOMAIN as a
// legacy fallback - set either, not both.
const COOKIE_DOMAIN_ENV = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || process.env.AUTH0_COOKIE_DOMAIN;

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,

  session: {
    cookie: {
      domain: COOKIE_DOMAIN_ENV, // '.empiriaindia.com'
    },
  },

  routes: {
    callback: '/auth/callback',
    login: '/auth/login',
    logout: '/auth/logout',
  },
});

/**
 * Safe wrapper around auth0.getSession() that returns null on any error
 * (e.g. stale cookie, mismatched secret, expired session).
 * Prevents showing a user as logged in when the session is actually invalid.
 */
export async function getSafeSession() {
  try {
    return await auth0.getSession();
  } catch {
    return null;
  }
}
