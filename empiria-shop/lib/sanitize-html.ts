// Strict allowlist sanitizer for organizer-authored rich text descriptions
// (bold / italic / underline / links / lists / paragraphs). Everything else is
// stripped: disallowed tags are removed, ALL attributes are dropped (so no
// onclick/style/etc.), and <a href> is kept only for http(s)/mailto.
//
// NOTE: regex-based + strict allowlist; adequate for authenticated organizer
// content. For untrusted/public HTML, swap in a vetted lib (DOMPurify).

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "a", "p", "br", "ul", "ol", "li", "span",
]);

export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  let out = html;

  // Remove HTML comments and dangerous element blocks (with their content).
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1\s*>/gi, "");

  // Walk every tag token: keep allowlisted tags (attribute-free, except a[href]).
  out = out.replace(
    /<\/?([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (match, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      if (match.startsWith("</")) return `</${name}>`;
      if (name === "a") {
        const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const raw = (m ? (m[2] ?? m[3] ?? m[4] ?? "") : "").trim();
        const safe = /^(https?:\/\/|mailto:)/i.test(raw) ? raw : "";
        return safe
          ? `<a href="${safe.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer nofollow">`
          : "<a>";
      }
      return `<${name}>`;
    }
  );

  return out;
}
