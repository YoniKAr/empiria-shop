import { APEX_URL } from "@/lib/urls";

/**
 * Legal agreement line shown directly under the final checkout CTA (the button
 * that hands off to Stripe). Links to the platform Terms & Privacy pages.
 */
export function CheckoutTerms({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[11px] leading-snug text-gray-500 ${className}`}>
      By purchasing tickets via Empiria Events, you agree to our{" "}
      <a
        href={`${APEX_URL}/terms`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        Terms &amp; Conditions
      </a>{" "}
      and{" "}
      <a
        href={`${APEX_URL}/privacy`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
