// ============================================================================
// index.ts — Main Entry Point: Dual-Router (Webhook + Cron)
// ============================================================================
//
// This Edge Function serves two distinct purposes:
//
//   Route A — Telegram Webhook (HTTP POST from Telegram servers)
//             Triggered instantly when the user sends a command like
//             /start, /add_email, /block, /vip, /snooze, /digest.
//             Identified by the presence of the `X-Telegram-Bot-Api-Secret-Token` header.
//
//   Route B — Cron Job (HTTP POST from Supabase pg_cron scheduler)
//             Triggered every 5 minutes to poll all connected inboxes,
//             summarize important emails, and push Telegram notifications.
//             Identified by the `x-cron-trigger` header.
//
// ============================================================================


import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";
import { handleWebhook } from "./webhookHandler.ts";
import { runEmailPoller } from "./emailPoller.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  // ─────────────────────────────────────────────────────────────────────────
  // Only accept POST requests
  // ─────────────────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialize the Supabase admin client (bypasses RLS for privileged access)
  // ─────────────────────────────────────────────────────────────────────────
  const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    { auth: { persistSession: false } }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTE A: Telegram Webhook
  // Telegram sends a secret token header on every webhook request.
  // We validate it to ensure the request is genuinely from Telegram.
  // ─────────────────────────────────────────────────────────────────────────
  const telegramSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (telegramSecret) {
    // Reject immediately if the secret doesn't match ours
    if (telegramSecret !== config.telegram.webhookSecret) {
      console.warn("[Router] Webhook received with invalid secret token.");
      return new Response("Forbidden: Invalid Secret", { status: 403 });
    }

    try {
      const update = await req.json();
      await handleWebhook(update, supabase);
      // Telegram requires a 200 OK response quickly, otherwise it retries
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("[Router] Error processing Telegram webhook:", err);
      // Return 200 anyway to prevent Telegram from retrying a bad payload
      return new Response("OK", { status: 200 });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTE B: Cron Job Trigger
  // Supabase pg_cron sends a POST request with a custom header.
  // ─────────────────────────────────────────────────────────────────────────
  const cronTrigger = req.headers.get("x-cron-trigger");
  if (cronTrigger === "email-poller") {
    try {
      console.log("[Router] Cron triggered — starting email polling.");
      await runEmailPoller(supabase);
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[Router] Error during email polling:", err);
      return new Response(JSON.stringify({ status: "error", message: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // No valid route matched
  // ─────────────────────────────────────────────────────────────────────────
  console.warn("[Router] Request received with no matching route headers.");
  return new Response("Bad Request", { status: 400 });
});
