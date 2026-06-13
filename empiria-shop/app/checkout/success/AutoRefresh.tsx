'use client';

// ──────────────────────────────────────────────────
// app/checkout/success/AutoRefresh.tsx
// Rendered only while the webhook is still fulfilling the order (no order row
// yet). Re-fetches the server page a few times so "this page will update
// shortly" is actually true, then stops to avoid refreshing forever.
// ──────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({
  intervalMs = 4000,
  maxAttempts = 5,
}: {
  intervalMs?: number;
  maxAttempts?: number;
}) {
  const router = useRouter();
  const attempts = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      attempts.current += 1;
      if (attempts.current > maxAttempts) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, maxAttempts]);

  return null;
}
