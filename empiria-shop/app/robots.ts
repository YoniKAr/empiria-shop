import type { MetadataRoute } from "next";
import { SHOP_URL } from "@/lib/urls";

/**
 * Robots policy for the shop. We block private/functional paths (API, checkout
 * flow, ticket short-links) but explicitly WELCOME major AI crawlers — they get
 * their own allow rules so a future tightening of the "*" rule never
 * accidentally blocks them.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = ["/api/", "/checkout/", "/t/"];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      // Explicitly allow major AI crawlers.
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "Claude-Web", allow: "/" },
      { userAgent: "anthropic-ai", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
    ],
    sitemap: `${SHOP_URL}/sitemap.xml`,
    host: SHOP_URL,
  };
}
