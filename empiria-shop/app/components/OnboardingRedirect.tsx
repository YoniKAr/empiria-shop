'use client';

import { useEffect } from 'react';

/**
 * Checks for the `emperia_redirect` cookie set by the onboarding app.
 * After Auth0 completes login, the user may land on the wrong app.
 * This component reads the cookie, clears it, and redirects to the
 * correct destination (e.g. shop for attendees, organizer for organizers).
 */
export default function OnboardingRedirect() {
  useEffect(() => {
    const match = document.cookie.match(/emperia_redirect=([^;]+)/);
    if (!match) return;
    const target = decodeURIComponent(match[1]);
    // Clear the cookie
    document.cookie = 'emperia_redirect=;domain=.empiriaindia.com;path=/;max-age=0';
    // Only redirect if the target is a different origin
    if (target && !window.location.href.startsWith(target)) {
      window.location.href = target;
    }
  }, []);

  return null;
}
