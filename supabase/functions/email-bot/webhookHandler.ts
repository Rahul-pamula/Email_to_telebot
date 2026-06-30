// ============================================================================
// webhookHandler.ts — Handles all incoming Telegram commands & button presses
// Phase 6
// ============================================================================

import { SupabaseClient } from "@supabase/supabase-js";
import { TelegramUpdate } from "./types.ts";
import {
  sendMessage,
  sendInteractiveMenu,
  answerCallbackQuery,
  editMessageText,
  escapeHtml
} from "./telegram.ts";

// ─────────────────────────────────────────────────────────────────────────────
// State machine states for multi-step conversations (e.g., /add_email)
// Stored in user_preferences.pending_action as JSONB
// ─────────────────────────────────────────────────────────────────────────────
interface PendingAction {
  type: "await_email" | "await_password";
  email?: string; // Stored between steps of /add_email
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — routes to the correct handler
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWebhook(
  update: TelegramUpdate,
  supabase: SupabaseClient
): Promise<void> {
  // Handle inline button presses
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, supabase);
    return;
  }

  // Handle text messages and commands
  if (update.message?.text) {
    await handleMessage(update.message, supabase);
    return;
  }

  console.log("[Webhook] Received update with no actionable content.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Handler — routes commands and stateful conversation steps
// ─────────────────────────────────────────────────────────────────────────────
async function handleMessage(
  message: NonNullable<TelegramUpdate["message"]>,
  supabase: SupabaseClient
): Promise<void> {
  // Guard: text might be undefined if message contains media (photo, sticker, etc.)
  if (!message.text) return;

  const chatId = message.chat.id;
  const telegramId = message.from.id;
  const text = message.text.trim();

  // ── Ensure the user exists in our DB ────────────────────────────────────
  await upsertUser(supabase, message.from);

  // ── Check for an active stateful conversation ────────────────────────────
  const pendingAction = await getPendingAction(supabase, telegramId);
  if (pendingAction) {
    await handleStatefulInput(text, chatId, telegramId, pendingAction, supabase);
    return;
  }

  // ── Route top-level commands ─────────────────────────────────────────────
  if (text.startsWith("/start")) {
    await handleStart(chatId, message.from.first_name);
  } else if (text.startsWith("/add_email")) {
    await handleAddEmailStart(chatId, telegramId, supabase);
  } else if (text.startsWith("/list_emails")) {
    await handleListEmails(chatId, telegramId, supabase);
  } else if (text.startsWith("/remove_email")) {
    await handleRemoveEmailInteractive(chatId, telegramId, supabase);
  } else if (text.startsWith("/settings")) {
    await handleSettingsMenu(chatId, telegramId, supabase);
  } else if (text.startsWith("/digest")) {
    await handleDigest(chatId, telegramId, supabase);
  } else if (text.startsWith("/help")) {
    await handleHelp(chatId);
  } else {
    await sendMessage(chatId, "❓ Unknown command. Type /help to see all available commands.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback Query Handler — handles inline button presses
// ─────────────────────────────────────────────────────────────────────────────
async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  supabase: SupabaseClient
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const telegramId = callbackQuery.from.id;
  const data = callbackQuery.data || "";

  if (!chatId || !messageId) return;

  // ── Block sender from Summary (blk:<email>) ──────────────────────────────
  if (data.startsWith("blk:")) {
    const senderEmail = data.replace("blk:", "").trim();
    await supabase.from("blocklist").upsert({
      user_telegram_id: telegramId,
      sender_email: senderEmail,
    });
    await answerCallbackQuery(callbackQuery.id, `🔕 Muted ${senderEmail}`);
    await editMessageText(chatId, messageId, `🔕 <b>Sender muted</b>: <code>${escapeHtml(senderEmail)}</code>\nYou won't receive summaries from this sender anymore.`);
  }

  // ── Snooze 1 hour (s1h:<shortId>) ────────────────────────────────────────
  else if (data.startsWith("s1h:")) {
    const snoozeUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await supabase.from("user_preferences").upsert({
      user_telegram_id: telegramId,
      snooze_until: snoozeUntil,
    });
    await answerCallbackQuery(callbackQuery.id, "🕒 Remind later (1 hour)");
    await editMessageText(chatId, messageId, "🕒 <b>Notifications snoozed for 1 hour.</b>\nI'll resume sending summaries after that.");
  }

  // ── Interactive Remove Email (rm_em:<email>) ─────────────────────────────
  else if (data.startsWith("rm_em:")) {
    const email = data.replace("rm_em:", "").trim();
    if (email === "cancel") {
      await answerCallbackQuery(callbackQuery.id);
      await editMessageText(chatId, messageId, "Action cancelled.");
      return;
    }

    const { error } = await supabase
      .from("email_accounts")
      .delete()
      .eq("user_telegram_id", telegramId)
      .eq("email_address", email.toLowerCase());

    if (error) {
      await answerCallbackQuery(callbackQuery.id, "❌ Failed to remove.");
    } else {
      await answerCallbackQuery(callbackQuery.id, `✅ Disconnected ${email}`);
      await editMessageText(chatId, messageId, `✅ <b>${escapeHtml(email)}</b> has been securely disconnected.`);
    }
  }

  // ── Settings Main Menu ───────────────────────────────────────────────────
  else if (data === "settings_main") {
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = [
      [{ text: "🚫 Manage Blocked Senders", callback_data: "settings_block" }],
      [{ text: "⭐ Manage VIPs", callback_data: "settings_vip" }],
      [{ text: "⏰ Clear Active Snoozes", callback_data: "clear_snooze" }],
    ];
    await editMessageText(chatId, messageId, "⚙️ <b>Your Preferences</b>\nSelect a category below:", keyboard);
  }

  // ── Settings: Blocked List ───────────────────────────────────────────────
  else if (data === "settings_block") {
    const { data: blocked } = await supabase.from("blocklist").select("sender_email").eq("user_telegram_id", telegramId);
    if (!blocked || blocked.length === 0) {
      await answerCallbackQuery(callbackQuery.id, "No blocked senders.");
      await editMessageText(chatId, messageId, "🔕 You don't have any blocked senders.", [[{ text: "🔙 Back to Settings", callback_data: "settings_main" }]]);
      return;
    }
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = blocked.map((b: any) => [{ text: `✅ Unblock ${b.sender_email}`, callback_data: `rm_blk:${b.sender_email}`.substring(0, 64) }]);
    keyboard.push([{ text: "🔙 Back to Settings", callback_data: "settings_main" }]);
    await editMessageText(chatId, messageId, "🔕 <b>Blocked Senders</b>\nTap to unblock:", keyboard);
  }

  // ── Settings: Remove Block ───────────────────────────────────────────────
  else if (data.startsWith("rm_blk:")) {
    const email = data.replace("rm_blk:", "").trim();
    await supabase.from("blocklist").delete().eq("user_telegram_id", telegramId).eq("sender_email", email);
    await answerCallbackQuery(callbackQuery.id, `Unblocked ${email}`);
    // Refresh the blocked list view
    callbackQuery.data = "settings_block";
    await handleCallbackQuery(callbackQuery, supabase);
  }

  // ── Settings: VIP List ───────────────────────────────────────────────────
  else if (data === "settings_vip") {
    const { data: vips } = await supabase.from("vip_list").select("sender_email").eq("user_telegram_id", telegramId);
    if (!vips || vips.length === 0) {
      await answerCallbackQuery(callbackQuery.id, "No VIP senders.");
      await editMessageText(chatId, messageId, "⭐ You don't have any VIP senders.\n<i>(VIP senders bypass AI filtering and always notify you.)</i>", [[{ text: "🔙 Back to Settings", callback_data: "settings_main" }]]);
      return;
    }
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = vips.map((v: any) => [{ text: `❌ Remove VIP ${v.sender_email}`, callback_data: `rm_vip:${v.sender_email}`.substring(0, 64) }]);
    keyboard.push([{ text: "🔙 Back to Settings", callback_data: "settings_main" }]);
    await editMessageText(chatId, messageId, "⭐ <b>VIP Senders</b>\nTap to remove from VIPs:", keyboard);
  }

  // ── Settings: Remove VIP ─────────────────────────────────────────────────
  else if (data.startsWith("rm_vip:")) {
    const email = data.replace("rm_vip:", "").trim();
    await supabase.from("vip_list").delete().eq("user_telegram_id", telegramId).eq("sender_email", email);
    await answerCallbackQuery(callbackQuery.id, `Removed ${email} from VIPs`);
    // Refresh the VIP list view
    callbackQuery.data = "settings_vip";
    await handleCallbackQuery(callbackQuery, supabase);
  }

  // ── Settings: Clear Snooze ───────────────────────────────────────────────
  else if (data === "clear_snooze") {
    await supabase.from("user_preferences").update({ snooze_until: null }).eq("user_telegram_id", telegramId);
    await answerCallbackQuery(callbackQuery.id, "Snoozes cleared!");
    await editMessageText(chatId, messageId, "⏰ <b>All snoozes cleared.</b> Notifications are active.", [[{ text: "🔙 Back to Settings", callback_data: "settings_main" }]]);
  }

  else {
    await answerCallbackQuery(callbackQuery.id, "Action completed.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleStart(chatId: number, firstName: string): Promise<void> {
  await sendMessage(
    chatId,
    `👋 Welcome, <b>${escapeHtml(firstName)}</b>!\n\n` +
    `I'm your personal <b>Email Summary Bot</b>. I'll monitor your inbox and send you smart AI summaries of important emails — right here in Telegram.\n\n` +
    `<b>Get started:</b>\n` +
    `• /add_email — Connect your first inbox\n` +
    `• /help — See all available commands\n\n` +
    `<i>I'm 100% free, private, and open-source.</i>`
  );
}

async function handleHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `📖 <b>Available Commands</b>\n\n` +
    `<b>📧 Email Management</b>\n` +
    `/add_email — Connect a new email inbox\n` +
    `/list_emails — View connected inboxes\n` +
    `/remove_email — Disconnect an inbox interactively\n\n` +
    `<b>⚙️ Preferences</b>\n` +
    `/settings — Manage Blocked Senders, VIPs, and Snoozes\n\n` +
    `<b>⏰ Notifications</b>\n` +
    `/digest — Get a summary of today's important emails`
  );
}

async function handleAddEmailStart(
  chatId: number,
  telegramId: number,
  supabase: SupabaseClient
): Promise<void> {
  await setPendingAction(supabase, telegramId, { type: "await_email" });
  await sendMessage(
    chatId,
    `📧 <b>Add Email Account</b>\n\n` +
    `Please send me your email address.\n` +
    `<i>Example: yourname@gmail.com</i>`
  );
}

async function handleListEmails(
  chatId: number,
  telegramId: number,
  supabase: SupabaseClient
): Promise<void> {
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("email_address, is_active")
    .eq("user_telegram_id", telegramId);

  if (!accounts || accounts.length === 0) {
    await sendMessage(chatId, "📭 No email accounts connected yet. Use /add_email to add one.");
    return;
  }

  const list = accounts
    .map((a: { email_address: string; is_active: boolean }, i: number) =>
      `${i + 1}. <code>${escapeHtml(a.email_address)}</code> ${a.is_active ? "✅" : "⏸"}`
    )
    .join("\n");

  await sendMessage(chatId, `📧 <b>Your Connected Inboxes:</b>\n\n${list}`);
}

async function handleRemoveEmailInteractive(
  chatId: number,
  telegramId: number,
  supabase: SupabaseClient
): Promise<void> {
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("email_address")
    .eq("user_telegram_id", telegramId);

  if (!accounts || accounts.length === 0) {
    await sendMessage(chatId, "📭 You don't have any connected email accounts to remove.");
    return;
  }

  const keyboard = accounts.map((a: { email_address: string }) => [
    { text: `❌ Disconnect ${a.email_address}`, callback_data: `rm_em:${a.email_address}`.substring(0, 64) }
  ]);
  keyboard.push([{ text: "🔙 Cancel", callback_data: "rm_em:cancel" }]);

  await sendInteractiveMenu(chatId, "🗑 <b>Which account would you like to disconnect?</b>\n<i>This will securely remove it and its App Password from the system.</i>", keyboard);
}

async function handleSettingsMenu(
  chatId: number,
  telegramId: number,
  supabase: SupabaseClient
): Promise<void> {
  const keyboard = [
    [{ text: "🚫 Manage Blocked Senders", callback_data: "settings_block" }],
    [{ text: "⭐ Manage VIPs", callback_data: "settings_vip" }],
    [{ text: "⏰ Clear Active Snoozes", callback_data: "clear_snooze" }],
  ];
  await sendInteractiveMenu(chatId, "⚙️ <b>Your Preferences</b>\nSelect a category below:", keyboard);
}

async function handleDigest(
  chatId: number,
  telegramId: number,
  supabase: SupabaseClient
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: summaries } = await supabase
    .from("processed_emails")
    .select("subject, sender, summary, processed_at")
    .gte("processed_at", since)
    .not("summary", "is", null)
    .order("processed_at", { ascending: false });

  if (!summaries || summaries.length === 0) {
    await sendMessage(chatId, "📭 No important emails in the last 24 hours.");
    return;
  }

  let text = `📊 <b>Your Digest</b> — last 24 hours (${summaries.length} important)\n\n`;
  for (const [i, s] of summaries.entries()) {
    text += `<b>${i + 1}. ${escapeHtml(s.subject)}</b>\n<i>From: ${escapeHtml(s.sender)}</i>\n${escapeHtml(s.summary)}\n\n`;
  }

  await sendMessage(chatId, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful Conversation Handler (/add_email multi-step flow)
// ─────────────────────────────────────────────────────────────────────────────
async function handleStatefulInput(
  text: string,
  chatId: number,
  telegramId: number,
  pending: PendingAction,
  supabase: SupabaseClient
): Promise<void> {
  // Allow user to cancel at any time
  if (text.startsWith("/")) {
    await clearPendingAction(supabase, telegramId);
    await sendMessage(chatId, "❌ Action cancelled. Type /help to see all commands.");
    return;
  }

  if (pending.type === "await_email") {
    if (!text.includes("@") || !text.includes(".")) {
      await sendMessage(chatId, "⚠️ That doesn't look like a valid email. Please try again:");
      return;
    }

    await setPendingAction(supabase, telegramId, {
      type: "await_password",
      email: text.toLowerCase().trim(),
    });

    await sendMessage(
      chatId,
      `✅ Got it: <code>${escapeHtml(text)}</code>\n\n` +
      `Now, please send me your <b>Gmail App Password</b>.\n\n` +
      `<i>How to get one:</i>\n` +
      `1. Go to myaccount.google.com\n` +
      `2. Security → 2-Step Verification → App passwords\n` +
      `3. Create a new one and paste the 16-character code here.\n\n` +
      `⚠️ <b>Delete this message after sending for safety.</b>`
    );
    return;
  }

  if (pending.type === "await_password" && pending.email) {
    const appPassword = text.replace(/\s/g, "");

    if (appPassword.length < 16) {
      await sendMessage(chatId, "⚠️ App Password seems too short. Gmail App Passwords are 16 characters. Please try again:");
      return;
    }

    const success = await saveEmailAccount(
      supabase,
      telegramId,
      pending.email,
      appPassword
    );

    await clearPendingAction(supabase, telegramId);

    if (success) {
      await sendMessage(
        chatId,
        `🎉 <b>${escapeHtml(pending.email)}</b> has been connected successfully!\n\n` +
        `I'll start monitoring your inbox and send you summaries of important emails.\n` +
        `The first check will happen within 5 minutes.\n\n` +
        `<i>Please delete your message containing the App Password from this chat.</i>`
      );
    } else {
      await sendMessage(chatId, `❌ Failed to connect <b>${escapeHtml(pending.email)}</b>. Please try /add_email again.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function upsertUser(
  supabase: SupabaseClient,
  from: { id: number; first_name: string; username?: string }
): Promise<void> {
  await supabase.from("users").upsert({
    telegram_id: from.id,
    first_name: from.first_name,
    username: from.username || null,
    updated_at: new Date().toISOString(),
  });
}

async function getPendingAction(
  supabase: SupabaseClient,
  telegramId: number
): Promise<PendingAction | null> {
  const { data } = await supabase
    .from("user_preferences")
    .select("pending_action")
    .eq("user_telegram_id", telegramId)
    .single();
  return data?.pending_action ?? null;
}

async function setPendingAction(
  supabase: SupabaseClient,
  telegramId: number,
  action: PendingAction
): Promise<void> {
  await supabase.from("user_preferences").upsert({
    user_telegram_id: telegramId,
    pending_action: action,
  });
}

async function clearPendingAction(
  supabase: SupabaseClient,
  telegramId: number
): Promise<void> {
  await supabase
    .from("user_preferences")
    .update({ pending_action: null })
    .eq("user_telegram_id", telegramId);
}

async function saveEmailAccount(
  supabase: SupabaseClient,
  telegramId: number,
  emailAddress: string,
  appPassword: string
): Promise<boolean> {
  try {
    const { data: secretId, error: vaultError } = await supabase.rpc(
      "vault_create_secret",
      {
        secret: appPassword,
        name: `app_password_${telegramId}_${emailAddress}`,
      }
    );

    if (vaultError || !secretId) {
      console.error("[Webhook] Failed to store secret in Vault:", vaultError);
      return false;
    }

    const { error: dbError } = await supabase.from("email_accounts").upsert({
      user_telegram_id: telegramId,
      email_address: emailAddress,
      app_password_secret_id: secretId,
      is_active: true,
    });

    if (dbError) {
      console.error("[Webhook] Failed to save email account:", dbError);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Webhook] Unexpected error in saveEmailAccount:", err);
    return false;
  }
}
