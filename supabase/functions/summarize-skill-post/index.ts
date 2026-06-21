import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// summarize-skill-post — turns one worker skill post into a short feed card:
//   (a) a bold skill title  (3-5 words)
//   (b) a one-sentence description (under 25 words)
// using Google's Gemini API, returned as structured JSON we can parse.
//
// SECURITY:
//  * The Gemini API key lives ONLY here, in the function's environment
//    (GEMINI_API_KEY). It is never sent to the app and never logged.
//  * The function requires an authenticated Supabase user (verify_jwt is on AND
//    we re-check the token below), so it can't be called anonymously to burn the
//    Gemini quota.
//  * We never log the caller's inputs (bio/description can contain personal
//    details, and location is personal data).

// Model is configurable via the GEMINI_MODEL secret so you can switch models
// (e.g. if one has no free-tier quota) without a redeploy. Defaults to a current
// free-tier flash model.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Allow the app (including the web build) to call this function.
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

  // Guard: require an authenticated caller. We build a client with the caller's
  // Authorization header and ask Supabase who they are; no user -> reject.
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
  if (!apiKey) return json({ error: 'Server is not configured for post summaries.' }, 500);

  // Parse and lightly validate the inputs (the app validates first; this is a
  // defensive re-check so a bad body can't produce a nonsense prompt).
  let payload: {
    description?: string;
    experienceLength?: string;
    totalSlots?: number;
    pricingRate?: number;
    bio?: string;
    location?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const description = String(payload.description ?? '').trim();
  const experienceLength = String(payload.experienceLength ?? '').trim();
  const bio = String(payload.bio ?? '').trim();
  const location = String(payload.location ?? '').trim();

  // Guard: need at least a description to summarize anything useful.
  if (!description) return json({ error: 'Missing description.' }, 400);

  const prompt =
    'You write short marketplace listing copy for an informal-work app. From the ' +
    'worker info below, produce a feed card with exactly two fields:\n' +
    '- "title": a punchy skill title of 3 to 5 words (e.g. "Reliable House Cleaning Service"). No quotes.\n' +
    '- "shortDescription": one friendly sentence under 25 words summarizing the offer.\n' +
    'The worker may write in Tagalog, Cebuano/Bisaya, Taglish or English; always write ' +
    'BOTH fields in natural English by translating the meaning (never transliterate or keep the original language).\n' +
    'Keep it natural and not corporate-sounding. Respond with JSON only.\n\n' +
    `Skill description: ${description}\n` +
    `Experience: ${experienceLength || 'not specified'}\n` +
    `Worker bio: ${bio || 'not specified'}\n` +
    `Location: ${location || 'not specified'}`;

  // Call Gemini. Any failure here is returned as a non-2xx so the app falls back
  // to its non-AI summary instead of blocking the worker from posting.
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 256,
          // Ask Gemini for structured JSON so we parse fields instead of prose.
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              shortDescription: { type: 'string' },
            },
            required: ['title', 'shortDescription'],
          },
          // gemini-2.5-* "thinks" by default, which silently eats the output
          // budget. We don't need reasoning for a short summary, so disable it.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    // Guard: rate limit / quota / upstream error -> tell the app it's unavailable.
    if (!res.ok) {
      return json({ error: 'Post summary is unavailable right now.' }, 502);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    // Guard: empty completion -> failure (app falls back to its own summary).
    if (!text) return json({ error: 'Post summary returned no text.' }, 502);

    // The response is JSON (responseMimeType above). Parse defensively.
    let parsed: { title?: string; shortDescription?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: 'Post summary returned invalid JSON.' }, 502);
    }

    const title = String(parsed.title ?? '').trim();
    const shortDescription = String(parsed.shortDescription ?? '').trim();

    // Guard: both fields are required; a missing one is treated as a failure.
    if (!title || !shortDescription) {
      return json({ error: 'Post summary was incomplete.' }, 502);
    }

    return json({ title, shortDescription });
  } catch {
    return json({ error: 'Post summary failed.' }, 502);
  }
});
