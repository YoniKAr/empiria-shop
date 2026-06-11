// Public branded error page that Auth0's tenant Error Page setting points to
// (Tenant Settings → Error Pages → "Redirect users to your own error page").
// Auth0 appends ?client_id=&connection=&lang=&error=&error_description=&tracking= —
// we surface a friendly message and a way back in, and NEVER show the tenant name.
export const dynamic = "force-dynamic";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const desc =
    typeof params.error_description === "string" ? params.error_description : "";

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-bold tracking-tight text-gray-900">
          Empiria<span className="text-[#F15A29]"> Events</span>
        </p>

        <div className="mx-auto my-6 flex h-12 w-12 items-center justify-center rounded-full bg-orange-50">
          <svg
            className="h-6 w-6 text-[#F15A29]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900">
          Your sign-in was interrupted
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Your session expired or the sign-in didn&apos;t finish — this usually
          happens after pressing back or refreshing during login. Please try
          again.
        </p>

        {desc ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">
            {desc}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col gap-3">
          <a
            href="/auth/login"
            className="inline-block w-full rounded-full bg-[#F15A29] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#e07d15]"
          >
            Log in again
          </a>
          <a
            href="/"
            className="inline-block w-full rounded-full border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Browse events
          </a>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          Still stuck? Contact{" "}
          <a
            href="mailto:info@empiria.events"
            className="font-medium text-[#F15A29] hover:underline"
          >
            info@empiria.events
          </a>
          .
        </p>
      </div>
    </main>
  );
}
