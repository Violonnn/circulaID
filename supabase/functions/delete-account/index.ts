import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// delete-account — lets a signed-in user permanently delete their OWN account.
//
// SECURITY:
//  * We FIRST identify the caller from their JWT (anon client + their token).
//    Only that exact user id is deleted — a user can never delete someone else.
//  * The actual delete needs admin rights, so we use a SEPARATE service-role
//    client. The service-role key lives ONLY in the function environment
//    (SUPABASE_SERVICE_ROLE_KEY, injected by Supabase) — never in the app.
//  * Deleting the auth user cascades to public.users and everything that
//    references it (worker_profiles, worker_posts, wallets, hires, etc.).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Guard: only POST is supported.
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Guard: require an authenticated caller and learn WHO they are from the token.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: auth } = await callerClient.auth.getUser();
  if (!auth?.user) return json({ error: 'Unauthorized' }, 401);

  // Guard: the service-role key must be configured (Supabase injects it).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'Server is not configured for account deletion.' }, 500);

  // Admin client (bypasses RLS) used ONLY to delete this exact caller's id.
  const adminClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
  const { error } = await adminClient.auth.admin.deleteUser(auth.user.id);

  // Guard: report a failed delete instead of leaving the app in a bad state.
  if (error) return json({ error: 'Could not delete account.' }, 500);

  return json({ success: true });
});
