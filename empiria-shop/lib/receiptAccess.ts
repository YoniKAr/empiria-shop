import type { SupabaseClient } from '@supabase/supabase-js';
import { notFound, redirect } from 'next/navigation';
import { getSafeSession } from '@/lib/auth0';
import { verifyReceiptToken } from '@/lib/receiptToken';

/**
 * Shared access control for an order's receipt pages (`/receipt/[orderId]` and
 * its `/donation` slip). Access is granted when:
 *   (a) a valid share token is presented (buyers/guests open their own receipt
 *       straight from the confirmation email, no session needed), OR
 *   (b) a session user who is the buyer, a platform admin, or the event owner /
 *       a co-organizer.
 *
 * With neither a token nor a session, the viewer is sent through login (silent
 * SSO for anyone already signed in on another Empiria app) and returned to
 * `loginReturnTo`. Only an AUTHENTICATED-but-unauthorized viewer falls through
 * to `notFound()`. Both `redirect()` and `notFound()` throw, so this never
 * returns to the caller when access is denied.
 */
export async function assertReceiptAccess(
  supabase: SupabaseClient,
  args: {
    orderId: string;
    userId: string | null;
    eventId: string;
    token: string | null | undefined;
    loginReturnTo: string;
  }
): Promise<void> {
  const { orderId, userId, eventId, token, loginReturnTo } = args;

  let allowed = verifyReceiptToken(orderId, token);
  if (allowed) return;

  const session = await getSafeSession();
  const sub = session?.user?.sub ?? null;
  if (!sub) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(loginReturnTo)}`);
  }

  if (userId && userId === sub) {
    allowed = true;
  } else {
    const { data: viewer } = await supabase
      .from('users')
      .select('id, role')
      .eq('auth0_id', sub)
      .maybeSingle();
    if (viewer?.role === 'admin') {
      allowed = true;
    } else {
      // Event owner is stored as an auth0 sub; co-organizers key on users.id.
      const { data: ev } = await supabase
        .from('events')
        .select('organizer_id')
        .eq('id', eventId)
        .maybeSingle();
      if (ev?.organizer_id === sub) {
        allowed = true;
      } else if (viewer?.id) {
        const { data: co } = await supabase
          .from('event_organizers')
          .select('id')
          .eq('event_id', eventId)
          .eq('user_id', viewer.id)
          .maybeSingle();
        if (co) allowed = true;
      }
    }
  }

  if (!allowed) notFound();
}
