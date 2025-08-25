// api/summarize.ts — Vercel Edge Function that calls Gemini 1.5 Flash securely
export const config = { runtime: "edge" };

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

// allow your local dev and your future domain
const ALLOW_ORIGINS = [
  "http://localhost",
  "http://127.0.0.1",
  // add your production domain later, e.g. "https://app.poseiq.com"
];

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOW_ORIGINS.find((o) => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": allow || "*",
    "Access-Control-Allow-Headers": "content-type,authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return new Response("Use POST", { status: 405, headers: cors(req) });
  }

  // TEMP auth for testing (we'll switch to magic-link JWT later)
  const bearer = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.POSEIQ_APP_SECRET || ""}`;
  if (!process.env.POSEIQ_APP_SECRET || bearer !== expected) {
    return new Response("Unauthorized", { status: 401, headers: cors(req) });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const {
    text = "",
    style = "plain",
    mode = "balanced",
    clinical = true,
    targetWords = 0,
  } = body;
  if (!text || typeof text !== "string") {
    return new Response("Missing text", { status: 400, headers: cors(req) });
  }

  const goal =
    style === "bullets"
      ? "Summarise as 5 to 8 crisp bullet points."
      : style === "soap"
      ? "Summarise as a SOAP note with S:, O:, A:, P: concise lines."
      : "Summarise clearly and succinctly.";
  const detail =
    mode === "concise"
      ? "Keep it very short."
      : mode === "detailed"
      ? "Include key details and qualifiers."
      : "Balance brevity and coverage.";
  const len =
    Number(targetWords) > 0 ? `Target about ${Number(targetWords)} words.` : "";
  const tone = clinical
    ? "Use neutral, professional clinical language. Avoid speculation. Prefer observations and action items."
    : "";
  const system = [goal, detail, len, tone].filter(Boolean).join(" ");

  const gkey = process.env.GOOGLE_API_KEY || "";
  if (!gkey) {
    return new Response("Server missing GOOGLE_API_KEY", {
      status: 500,
      headers: cors(req),
    });
  }

  const gResp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(gkey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${system}\n\n${text}` }]}],
      generationConfig: { temperature: 0, maxOutputTokens: 512 },
    }),
  });

  if (!gResp.ok) {
    const errText = await gResp.text().catch(() => gResp.statusText);
    return new Response(`Gemini error: ${errText}`, {
      status: 502,
      headers: cors(req),
    });
  }

  const data = await gResp.json();
  const out = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || "")
    .join("")
    .trim();

  return new Response(JSON.stringify({ summary: out || "" }), {
    status: 200,
    headers: { "content-type": "application/json", ...cors(req) },
  });
}
