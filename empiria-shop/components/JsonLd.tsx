/**
 * Renders a JSON-LD structured-data <script>.
 *
 * SAFETY: `dangerouslySetInnerHTML` is used intentionally. We JSON.stringify a
 * structured object we build ourselves (schema.org Event/Organization/etc.) —
 * never raw user HTML — so there is no XSS vector. The `<` escaping guards
 * against a stray "</script>" inside any string value breaking out of the tag.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
