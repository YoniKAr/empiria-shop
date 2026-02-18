import { getSafeSession } from '@/lib/auth0';
import { createClient } from '@supabase/supabase-js';

export default async function CheckoutPage({ params }: { params: { eventId: string } }) {
  const session = await getSafeSession();
  const user = session?.user;

  // Fetch Event Info
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  const { data: event } = await supabase.from('events').select('title, start_at').eq('id', params.eventId).single();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Order Summary */}
        <div className="bg-white p-6 rounded-xl shadow-sm h-fit">
            <h2 className="text-xl font-bold mb-4">{event?.title}</h2>
            <div className="border-t border-b py-4 my-4 space-y-2">
                <div className="flex justify-between"><span>General Admission x 1</span><span>₹500.00</span></div>
                <div className="flex justify-between text-gray-500 text-sm"><span>Fees</span><span>₹25.00</span></div>
            </div>
            <div className="flex justify-between font-bold text-lg"><span>Total</span><span>₹525.00</span></div>
        </div>

        {/* Contact Info Form */}
        <div>
            <h1 className="text-2xl font-bold mb-6">Checkout</h1>
            
            {!user && (
                <div className="bg-blue-50 text-blue-800 p-4 rounded-lg mb-6 text-sm flex justify-between items-center">
                    <span>Already have an account?</span>
                    <a href="https://auth.empiriaindia.com/auth/login" className="font-bold hover:underline">Sign In</a>
                </div>
            )}

            <form className="bg-white p-6 rounded-xl shadow-sm space-y-4">
                <h3 className="font-bold border-b pb-2">Contact Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">First Name</label>
                        <input className="w-full border p-3 rounded-lg" defaultValue={user?.given_name} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Last Name</label>
                        <input className="w-full border p-3 rounded-lg" defaultValue={user?.family_name} />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email Address</label>
                    <input type="email" className="w-full border p-3 rounded-lg" defaultValue={user?.email} />
                    <p className="text-xs text-gray-400 mt-1">Your tickets will be sent here.</p>
                </div>

                <div className="pt-4">
                    <button type="button" className="w-full bg-black text-white py-4 rounded-xl font-bold">
                        Continue to Payment
                    </button>
                </div>
            </form>
        </div>

      </div>
    </div>
  );
}
