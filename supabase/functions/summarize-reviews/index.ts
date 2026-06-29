import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// summarize-reviews — produces a short, neutral AI summary of ALL of one
// worker's reviews, shown above the reviews list on the skill-post detail screen.
//
// Mirrors summarize-skill-post: the Gemini API key lives ONLY here, in the
// function environment (GEMINI_API_KEY); it is never sent to the app or logged.
//
// IMPORTANT — why this uses RPCs instead of a service-role client:
// Edge Functions in this project receive the NEW short API keys
// (sb_secret / sb_publishable). The injected SUPABASE_SERVICE_ROLE_KEY does NOT
// grant PostgREST table access here (a service-role read of `ratings` fails with
// "permission denied for table ratings"). So we use the CALLER's authenticated
// client to call two SECURITY DEFINER RPCs:
//   * get_or_check_review_summary — returns a fresh (< 7 day) cached summary, or
//     the worker's REAL review comments to summarize (read server-side, so the
//     shared cache can't be poisoned with client-supplied text).
//   * set_review_summary — persists a newly generated summary (bypasses the
//     owner-only RLS on worker_profiles).
//
// Reviews are tied to the worker across all posts, so the cache is per-worker.

// Same model knob + endpoint shape as summarize-skill-post.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// A summary is only worth generating with at least this many non-empty reviews.
const MIN_REVIEWS = 2;

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
  // Browsers send a preflight OPTIONS request before the POST.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Guard: only POST is supported.
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Guard: require an authenticated caller. The same client is reused for the
  // RPCs, so they run with this user's privileges (the RPCs are SECURITY DEFINER).
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'Unauthorized' }, 401);

  // Guard: the API key must be configured in the function environment.
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'Server is not configured for review summaries.' }, 500);

  // Parse the body. We only trust the workerId; the review TEXT is read
  // server-side (inside the RPC) so the shared cache can't be poisoned.
  let payload: { workerId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  const workerId = String(payload.workerId ?? '').trim();
  // Guard: no worker id -> nothing to summarize.
  if (!workerId) return json({ error: 'Missing workerId.' }, 400);

  // 1. Cache check + review fetch in one definer call.
  const { data: checkRows, error: checkError } = await supabase.rpc(
    'get_or_check_review_summary',
    { p_worker: workerId }
  );
  // Guard: a failure here -> no summary (screen renders nothing).
  if (checkError) return json({ summary: null });

  const row = Array.isArray(checkRows) ? checkRows[0] : checkRows;
  // Guard: no row back -> nothing to show.
  if (!row) return json({ summary: null });

  // Fresh cache -> return it without calling Gemini.
  if (row.needs_refresh === false) {
    const cached = typeof row.summary === 'string' ? row.summary.trim() : '';
    return json({ summary: cached.length > 0 ? cached : null });
  }

  const texts: string[] = Array.isArray(row.review_texts)
    ? row.review_texts.map((t: unknown) => String(t ?? '').trim()).filter((t: string) => t.length > 0)
    : [];

  // Guard: too few reviews to summarize -> no summary, no Gemini call.
  if (texts.length < MIN_REVIEWS) return json({ summary: null });

  // The worker's name personalizes the summary; fall back if it's missing.
  const workerName = typeof row.worker_name === 'string' ? row.worker_name.trim() : '';
  const subject = workerName.length > 0 ? workerName : 'this worker';

  const joined = texts.join('\n');
  const prompt =
    `You are summarizing reviews for a specific worker named ${subject} on a freelance hiring app.\n` +
    `Summarize all these reviews in 2 sentences, referring to the worker by name (${subject}).\n` +
    'Mention specific strengths and any concerns if present.\n' +
    'Write in third person. Be factual and neutral.\n\n' +
    'Reviews:\n' +
    joined +
    '\n\nReturn the summary text only. No labels, no formatting, no explanation.';

  // 2. Call Gemini. Any failure returns { summary: null } so the screen simply
  // renders nothing (never an error box).
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          // Cap at 150 (<= the 256 the post-summary function uses), per spec.
          maxOutputTokens: 150,
          // gemini-2.5-* "thinks" by default, which silently eats the output
          // budget. We don't need reasoning for a short summary, so disable it.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    // Guard: rate limit / quota / upstream error.
    if (!res.ok) return json({ summary: null });

    const data = await res.json();
    const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    // Guard: empty completion -> no summary.
    if (!summary) return json({ summary: null });

    // 3. Persist to the per-worker cache (best-effort; a write failure still
    // returns the fresh summary to the caller).
    await supabase.rpc('set_review_summary', { p_worker: workerId, p_summary: summary });

    return json({ summary });
  } catch {
    // Guard: a thrown network error also degrades to "no summary".
    return json({ summary: null });
  }
});
