'use client';

/**
 * Print / Save-as-PDF trigger. Hidden in the print output itself (the `print:hidden`
 * class on the wrapper), so it never appears on the printed/exported receipt.
 */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F15A29] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d94c1f]"
    >
      Print / Save as PDF
    </button>
  );
}
