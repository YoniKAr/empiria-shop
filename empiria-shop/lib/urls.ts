// Cross-app base URLs. Defaults = current dev domains; the empiria.events
// cutover flips these via Vercel env vars (NEXT_PUBLIC_* — set at BUILD time).
export const APEX_URL = process.env.NEXT_PUBLIC_APEX_URL || "https://www.empiriaindia.com";
export const SHOP_URL = process.env.NEXT_PUBLIC_SHOP_URL || "https://shop.empiriaindia.com";
export const ORGANIZER_URL = process.env.NEXT_PUBLIC_ORGANIZER_URL || "https://organizer.empiriaindia.com";
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "https://admin.empiriaindia.com";
export const PROFILE_URL = process.env.NEXT_PUBLIC_PROFILE_URL || "https://profile.empiriaindia.com";
export const ONBOARDING_URL = process.env.NEXT_PUBLIC_ONBOARDING_URL || "https://onboarding.empiriaindia.com";
export const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || ".empiriaindia.com";
