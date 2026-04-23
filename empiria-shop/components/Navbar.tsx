import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import UserMenu from './UserMenu';
import CurrencySelector from './CurrencySelector';

export default async function Navbar() {
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
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
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
              href="https://auth.empiriaindia.com/auth/login?returnTo=https://shop.empiriaindia.com"
              className="text-sm font-bold bg-black text-white px-5 py-2.5 rounded-full hover:bg-gray-800 transition-colors"
            >
              Sign In
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
