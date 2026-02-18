// ──────────────────────────────────────────────────
// 📁 lib/utils.ts — NEW FILE (create this)
// ──────────────────────────────────────────────────

/**
 * Format a monetary amount with proper currency symbol and locale.
 */
export function formatCurrency(amount: number, currency: string = 'cad'): string {
  const currencyMap: Record<string, { locale: string; currency: string }> = {
    cad: { locale: 'en-CA', currency: 'CAD' },
    usd: { locale: 'en-US', currency: 'USD' },
    inr: { locale: 'en-IN', currency: 'INR' },
    gbp: { locale: 'en-GB', currency: 'GBP' },
    eur: { locale: 'en-IE', currency: 'EUR' },
    aud: { locale: 'en-AU', currency: 'AUD' },
    nzd: { locale: 'en-NZ', currency: 'NZD' },
    sgd: { locale: 'en-SG', currency: 'SGD' },
    hkd: { locale: 'en-HK', currency: 'HKD' },
    jpy: { locale: 'ja-JP', currency: 'JPY' },
    mxn: { locale: 'es-MX', currency: 'MXN' },
    brl: { locale: 'pt-BR', currency: 'BRL' },
  };

  const config = currencyMap[currency.toLowerCase()] || currencyMap.cad;

  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
    minimumFractionDigits: currency.toLowerCase() === 'jpy' ? 0 : 2,
  }).format(amount);
}

/**
 * Get just the currency symbol for form labels.
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    cad: 'CA$', usd: '$', inr: '₹', gbp: '£', eur: '€',
    aud: 'A$', nzd: 'NZ$', sgd: 'S$', hkd: 'HK$', jpy: '¥',
    mxn: 'MX$', brl: 'R$',
  };
  return symbols[currency.toLowerCase()] || '$';
}

/**
 * Check if a currency uses zero-decimal amounts in Stripe.
 * Stripe expects amounts in the smallest currency unit (e.g., cents for USD).
 */
export function isZeroDecimalCurrency(currency: string): boolean {
  return ['jpy', 'krw', 'vnd'].includes(currency.toLowerCase());
}

/**
 * Convert a display amount to Stripe's smallest unit (cents, paise, etc.).
 */
export function toStripeAmount(amount: number, currency: string): number {
  if (isZeroDecimalCurrency(currency)) return Math.round(amount);
  return Math.round(amount * 100);
}

/**
 * Convert from Stripe's smallest unit back to display amount.
 */
export function fromStripeAmount(amount: number, currency: string): number {
  if (isZeroDecimalCurrency(currency)) return amount;
  return amount / 100;
}
