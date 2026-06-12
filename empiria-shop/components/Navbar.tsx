import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import UserMenu from './UserMenu';
import CurrencySelector from './CurrencySelector';
import MobileNav from './MobileNav';

export default async function Navbar({ overlay = false }: { overlay?: boolean }) {
  const session = await getSafeSession();
  const user = session?.user;

  let userRole: string | null = null;
  let defaultCurrency: string | null = null;
  let userFullName: string | null = null;
  if (user?.sub) {
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('users')
      .select('role, default_currency, full_name')
      .eq('auth0_id', user.sub)
      .single();
    userRole = profile?.role || null;
    defaultCurrency = profile?.default_currency || null;
    userFullName = profile?.full_name?.trim() || null;
  }

  // Greet by the real name; never show the email. Fall back to the Auth0 name (only if it
  // isn't itself an email), then the email's local part, then a friendly default.
  const displayName =
    userFullName ||
    (user?.name && !user.name.includes('@') ? user.name : '') ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'there';

  return (
    <>
    <nav className="fixed top-4 left-1/2 z-50 w-[94%] max-w-5xl -translate-x-1/2">
      <div className="relative flex items-center justify-between rounded-2xl bg-white px-4 sm:px-6 py-3 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2 sm:gap-8">
          {/* Mobile: links collapse into a hamburger dropdown */}
          <MobileNav />

          <Link href="/" className="flex items-center gap-2">
            {/* Logo size must match the home/landing navbar (100px) — keep in sync. */}
            <Image
              src="/logo.png"
              alt="Empiria Logo"
              width={100}
              height={33}
              className="object-contain w-[100px] h-auto"
              priority
            />
          </Link>

          <div className="hidden sm:flex items-center gap-6">
            <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Events</Link>
            <Link href="/gifft" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">GIFFT</Link>
            <Link href="/specials" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Specials</Link>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <CurrencySelector defaultCurrency={defaultCurrency || undefined} />
          {user ? (
            <UserMenu
              userName={displayName}
              userPicture={user.picture || null}
              userRole={userRole}
            />
          ) : (
            <a
              href="/auth/login"
              className="text-sm font-bold bg-black text-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-full hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              Sign In
            </a>
          )}
        </div>
      </div>
    </nav>
    {/* In-flow spacer so page content sits below the floating pill (skipped when a page wants its hero under the navbar) */}
    {!overlay && <div aria-hidden="true" className="h-20" />}
    </>
  );
}
