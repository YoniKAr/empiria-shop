import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import UserMenu from './UserMenu';
import CurrencySelector from './CurrencySelector';

export default async function Navbar({ overlay = false }: { overlay?: boolean }) {
  const session = await getSafeSession();
  const user = session?.user;

  let userRole: string | null = null;
  let defaultCurrency: string | null = null;
  if (user?.sub) {
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('users')
      .select('role, default_currency')
      .eq('auth0_id', user.sub)
      .single();
    userRole = profile?.role || null;
    defaultCurrency = profile?.default_currency || null;
  }

  return (
    <>
    <nav className="fixed top-4 left-1/2 z-50 w-[94%] max-w-5xl -translate-x-1/2">
      <div className="flex items-center justify-between rounded-2xl bg-white/90 backdrop-blur-md px-5 py-2 shadow-lg border border-gray-100">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Empiria Logo"
              width={130}
              height={40}
              className="object-contain"
              priority
            />
          </Link>

          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Events</Link>
            <Link href="/gifft" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">GIFFT</Link>
            <Link href="/specials" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Specials</Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <CurrencySelector defaultCurrency={defaultCurrency || undefined} />
          {user ? (
            <UserMenu
              userName={user.name || 'User'}
              userPicture={user.picture || null}
              userRole={userRole}
            />
          ) : (
            <a
              href="/auth/login"
              className="text-sm font-bold bg-black text-white px-5 py-2.5 rounded-full hover:bg-gray-800 transition-colors"
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
