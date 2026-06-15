import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

// Maps the event.refund_policy enum to a buyer-facing label shown under the
// price on the event page. Unknown/missing policy is treated as non-refundable
// (the platform default), never silently hidden.
const POLICY = {
  fully_refundable: {
    label: "Fully refundable",
    desc: "Get a full refund if you can no longer attend.",
    Icon: ShieldCheck,
    color: "text-emerald-700",
    box: "bg-emerald-50 border-emerald-200",
  },
  partial_refundable: {
    label: "Partially refundable",
    desc: "Partial refunds may be available — see the organizer's terms.",
    Icon: ShieldAlert,
    color: "text-amber-700",
    box: "bg-amber-50 border-amber-200",
  },
  non_refundable: {
    label: "Non-refundable",
    desc: "All sales are final.",
    Icon: ShieldX,
    color: "text-gray-600",
    box: "bg-gray-50 border-gray-200",
  },
} as const;

export function RefundPolicyNote({
  policy,
  className = "",
}: {
  policy?: string | null;
  className?: string;
}) {
  const key =
    policy === "fully_refundable" || policy === "partial_refundable"
      ? policy
      : "non_refundable";
  const p = POLICY[key];
  const Icon = p.Icon;
  return (
    <div className={`flex items-start gap-2 rounded-xl border ${p.box} px-3 py-2.5 ${className}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${p.color}`} />
      <div className="text-xs leading-snug">
        <span className={`font-semibold ${p.color}`}>{p.label}</span>
        <span className="block text-gray-600">{p.desc}</span>
      </div>
    </div>
  );
}
