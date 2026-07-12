// GlowPT · Supabase Edge Function · ai-response
// Generates the warm daily reflection. Lives in Supabase (not Netlify) so patient
// text is processed inside the HIPAA-ready environment. Becomes fully compliant at
// go-live once the Supabase Team plan + Anthropic BAA are in place.
//
// Deploy:  supabase functions deploy ai-response
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const FALLBACK = "You showed up today — and that's everything."

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { prompt } = await req.json()
    if (!prompt) {
      return new Response(JSON.stringify({ response: FALLBACK }), {
        headers: { ...cors, "Content-Type": "application/json" },
      })
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    const data = await resp.json()
    const text = data?.content?.[0]?.text ?? FALLBACK
    return new Response(JSON.stringify({ response: text }), {
      headers: { ...cors, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("ai-response error:", err)
    return new Response(JSON.stringify({ response: FALLBACK }), {
      headers: { ...cors, "Content-Type": "application/json" },
    })
  }
})
