// Cross-app base URLs (empiria.events). NEXT_PUBLIC_* env vars override at
// BUILD time; the defaults below are the live production domains.
export const APEX_URL = process.env.NEXT_PUBLIC_APEX_URL || "https://home.empiria.events";
export const SHOP_URL = process.env.NEXT_PUBLIC_SHOP_URL || "https://shop.empiria.events";
export const ORGANIZER_URL = process.env.NEXT_PUBLIC_ORGANIZER_URL || "https://organizer.empiria.events";
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "https://admins.empiria.events";
export const PROFILE_URL = process.env.NEXT_PUBLIC_PROFILE_URL || "https://profile.empiria.events";
export const ONBOARDING_URL = process.env.NEXT_PUBLIC_ONBOARDING_URL || "https://onboarding.empiria.events";
export const COOKIE_DOMAIN =
  "." + new URL(APEX_URL).hostname.replace(/^(www|home)\./, "");
