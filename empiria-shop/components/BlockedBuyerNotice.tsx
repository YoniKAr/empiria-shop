/**
 * Notice shown when a non-attendee account (organizer / non_profit / admin)
 * tries to buy tickets. Single source of truth for the copy so it never
 * drifts between the seatmap pickers, the ticket widget, etc.
 *
 * "Press here" logs the user out (Auth0 SDK v4 self-hosts /auth/logout) so
 * they can sign back in with an attendee account.
 */
export function BlockedBuyerNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs font-medium text-red-600 ${className}`.trim()}>
      You must be logged in with an attendee account to buy tickets.{" "}
      <a
        href="/auth/logout"
        className="font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
      >
        Press here to switch accounts
      </a>
    </p>
  );
}
