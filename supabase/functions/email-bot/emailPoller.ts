// ============================================================================
// emailPoller.ts — Cron-triggered email polling orchestrator
// ============================================================================


import { SupabaseClient } from "@supabase/supabase-js";
import { EmailAccount, ParsedEmail } from "./types.ts";
import { fetchUnseenEmails } from "./imapClient.ts";
import { analyzeEmail } from "./aiService.ts";
import { sendSummary } from "./telegram.ts";


/**
 * Main entry point triggered by the cron job every 5 minutes.
 * Orchestrates the full pipeline:
 *   1. Fetch all active email accounts from Supabase.
 *   2. Decrypt each account's App Password from Supabase Vault.
 *   3. Fetch unseen emails via IMAP.
 *   4. For each email: check blocklist → check VIP → run AI → send Telegram.
 *   5. Log the processed email to prevent duplicate notifications.
 */
export async function runEmailPoller(supabase: SupabaseClient): Promise<void> {
  console.log("[Poller] Starting email polling cycle...");

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Fetch all active email accounts from the database
  // ─────────────────────────────────────────────────────────────────────────
  const { data: accounts, error: accountsError } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true);

  if (accountsError) {
    console.error("[Poller] Failed to fetch email accounts:", accountsError);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log("[Poller] No active email accounts found. Exiting.");
    return;
  }

  console.log(`[Poller] Processing ${accounts.length} active account(s).`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Process each account concurrently using Promise.all
  // This is more efficient than processing them one-by-one sequentially.
  // ─────────────────────────────────────────────────────────────────────────
  await Promise.all(
    accounts.map((account: EmailAccount) =>
      processAccount(account, supabase).catch((err) => {
        // Log the error but don't crash the whole poller
        console.error(
          `[Poller] Error processing account ${account.email_address}:`,
          err
        );
      })
    )
  );

  console.log("[Poller] Polling cycle complete.");
}

/**
 * Processes a single email account through the full pipeline.
 */
async function processAccount(
  account: EmailAccount,
  supabase: SupabaseClient
): Promise<void> {
  console.log(`[Poller] Processing account: ${account.email_address}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2a: Decrypt the App Password from Supabase Vault
  // We call a Postgres function that reads from vault.secrets.
  // The actual password never sits in the email_accounts table.
  // ─────────────────────────────────────────────────────────────────────────
  const { data: secretData, error: secretError } = await supabase.rpc(
    "vault_read_secret",
    { secret_id: account.app_password_secret_id }
  );

  if (secretError || !secretData) {
    console.error(
      `[Poller] Could not decrypt App Password for ${account.email_address}:`,
      secretError
    );
    return;
  }

  const appPassword: string = secretData;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2b: Fetch unseen emails via IMAP
  // ─────────────────────────────────────────────────────────────────────────
  const emails: ParsedEmail[] = await fetchUnseenEmails(
    account.email_address,
    appPassword,
    account.imap_host,
    account.imap_port
  );

  if (emails.length === 0) {
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2c: Fetch the already-processed email IDs for this account
  // to avoid sending duplicate Telegram notifications.
  // ─────────────────────────────────────────────────────────────────────────
  const { data: processedRows } = await supabase
    .from("processed_emails")
    .select("message_id")
    .eq("email_account_id", account.id);

  const processedIds = new Set<string>(
    (processedRows || []).map((r: { message_id: string }) => r.message_id)
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2d: Fetch the blocklist for this user
  // ─────────────────────────────────────────────────────────────────────────
  const { data: blockedRows } = await supabase
    .from("blocklist")
    .select("sender_email")
    .eq("user_telegram_id", account.user_telegram_id);

  const blockedSenders = new Set<string>(
    (blockedRows || []).map((r: { sender_email: string }) =>
      r.sender_email.toLowerCase()
    )
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2e: Fetch the VIP list for this user
  // ─────────────────────────────────────────────────────────────────────────
  const { data: vipRows } = await supabase
    .from("vip_list")
    .select("sender_email")
    .eq("user_telegram_id", account.user_telegram_id);

  const vipSenders = new Set<string>(
    (vipRows || []).map((r: { sender_email: string }) =>
      r.sender_email.toLowerCase()
    )
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2f: Process each individual email through the pipeline
  // (AI check, Telegram send, DB log) — Phase 5 & 6 will fill in aiService
  // and telegram modules. For now the pipeline structure is in place.
  // ─────────────────────────────────────────────────────────────────────────
  for (const email of emails) {
    await processEmail(
      email,
      account,
      supabase,
      processedIds,
      blockedSenders,
      vipSenders
    );
  }

  // Update last polled timestamp
  await supabase
    .from("email_accounts")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", account.id);
}

/**
 * Runs a single email through the full filter pipeline.
 */
async function processEmail(
  email: ParsedEmail,
  account: EmailAccount,
  supabase: SupabaseClient,
  processedIds: Set<string>,
  blockedSenders: Set<string>,
  vipSenders: Set<string>
): Promise<void> {
  // Gate 1: Already processed?
  if (processedIds.has(email.messageId)) {
    console.log(`[Poller] Skipping already-processed email: ${email.subject}`);
    return;
  }

  // Extract just the email address part for matching
  const senderEmail = extractEmail(email.from).toLowerCase();

  // Gate 2: Sender is blocked?
  if (blockedSenders.has(senderEmail)) {
    console.log(`[Poller] Skipping blocked sender: ${senderEmail}`);
    // Still log it as processed so we don't check it again
    await logProcessed(supabase, email, account.id, null);
    return;
  }

  // Gate 3: Is the user currently snoozed?
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("snooze_until")
    .eq("user_telegram_id", account.user_telegram_id)
    .single();

  const isSnoozed =
    prefs?.snooze_until && new Date(prefs.snooze_until) > new Date();

  const isVip = vipSenders.has(senderEmail);

  // Gate 4: AI importance classification (skip if VIP — always notify)
  let summary: string | null = null;

  if (!isVip) {
    const aiResult = await analyzeEmail(email.from, email.subject, email.body);
    if (!aiResult.isImportant) {
      console.log(`[Poller] AI classified as ROUTINE, skipping: ${email.subject}`);
      await logProcessed(supabase, email, account.id, null);
      return;
    }
    summary = aiResult.summary;
  } else {
    // VIP emails skip AI — add a note to the summary
    summary = `⭐ VIP sender — email not filtered by AI.\n_Subject: ${email.subject}_`;
    console.log(`[Poller] VIP email from ${senderEmail}, bypassing AI.`);
  }

  // Gate 5: If snoozed, queue the summary for later delivery
  if (isSnoozed) {
    await supabase.from("snooze_queue").insert({
      user_telegram_id: account.user_telegram_id,
      summary_text: `*${email.subject}*\n_From: ${email.from}_\n${summary ?? ""}`,
      scheduled_for: prefs.snooze_until,
    });
    console.log(`[Poller] User is snoozed — summary queued for later.`);
    await logProcessed(supabase, email, account.id, summary);
    return;
  }

  // Deliver via Telegram
  await sendSummary(
    account.user_telegram_id,
    email.from,
    email.subject,
    account.email_address,
    summary ?? `⚠️ AI Summary unavailable.`,
    email.messageId
  );

  console.log(`[Poller] ✅ Summary sent for: ${email.subject}`);
  await logProcessed(supabase, email, account.id, summary);
}


/**
 * Saves a Message-ID to the processed_emails table to prevent duplicates.
 */
async function logProcessed(
  supabase: SupabaseClient,
  email: ParsedEmail,
  emailAccountId: string,
  summary: string | null
): Promise<void> {
  const { error } = await supabase.from("processed_emails").upsert({
    message_id: email.messageId,
    email_account_id: emailAccountId,
    subject: email.subject,
    sender: email.from,
    summary,
  });
  if (error) {
    console.warn("[Poller] Failed to log processed email:", error);
  }
}

/**
 * Extracts the plain email address from a formatted "Name <email>" string.
 */
function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}
