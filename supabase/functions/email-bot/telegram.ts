// ============================================================================
// telegram.ts — Telegram Bot API Wrapper
// Phase 6
// ============================================================================


import { config } from "./config.ts";

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

// ─────────────────────────────────────────────────────────────────────────────
// Core API helper — all Telegram calls go through this
// ─────────────────────────────────────────────────────────────────────────────
async function callTelegramApi(
  method: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Telegram] API error on ${method}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a plain text message (HTML supported).
 */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

/**
 * Sends a message with an inline keyboard menu.
 */
export async function sendInteractiveMenu(
  chatId: number,
  text: string,
  inlineKeyboard: any
): Promise<void> {
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

/**
 * Sends an email summary with inline action buttons below it.
 *
 * Button callback_data format (max 64 bytes each):
 *  - "blk:<sender_email>"   → Block this sender
 *  - "s1h:<message_id>"     → Snooze summary for 1 hour
 *  - "s24:<message_id>"     → Snooze summary for 24 hours (tomorrow)
 */
export async function sendSummary(
  chatId: number,
  from: string,
  subject: string,
  emailAddress: string,
  summary: string,
  messageId: string
): Promise<void> {
  const senderEmail = extractEmail(from);

  const text =
    `📧 <b>New Important Email</b>\n` +
    `<b>From:</b> ${escapeHtml(from)}\n` +
    `<b>Account:</b> ${escapeHtml(emailAddress)}\n` +
    `<b>Subject:</b> ${escapeHtml(subject)}\n\n` +
    `${escapeHtml(summary)}`; // The AI summary itself shouldn't have HTML, so we escape it just in case. Wait, if we want emojis to show, escapeHtml doesn't touch emojis.

  // Shorten message_id for callback_data (Telegram has a 64-byte limit)
  const shortId = btoa(messageId).substring(0, 20).replace(/[+=\/]/g, "");

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "↗️ Open in Inbox", url: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}` },
      ],
      [
        { text: "🔕 Mute this user", callback_data: `blk:${senderEmail}`.substring(0, 64) },
        { text: "⭐ Add to VIP", callback_data: `vip:${senderEmail}`.substring(0, 64) },
      ],
      [
        { text: "🕒 Remind later", callback_data: `s1h:${shortId}` },
      ],
    ],
  };

  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: inlineKeyboard,
  });
}

/**
 * Sends a multi-account summary digest (used by /digest command).
 */
export async function sendDigest(
  chatId: number,
  summaries: { from: string; subject: string; summary: string }[]
): Promise<void> {
  if (summaries.length === 0) {
    await sendMessage(chatId, "📭 No important emails in the last 24 hours.");
    return;
  }

  let text = `📊 <b>Your Daily Digest</b> (${summaries.length} important email${summaries.length > 1 ? "s" : ""})\n\n`;

  for (const [i, item] of summaries.entries()) {
    text +=
      `<b>${i + 1}. ${escapeHtml(item.subject)}</b>\n` +
      `<i>From: ${escapeHtml(item.from)}</i>\n` +
      `${escapeHtml(item.summary)}\n\n`;
  }

  await sendMessage(chatId, text);
}

/**
 * Acknowledges a Telegram inline button press (required by Telegram API).
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "✅ Done!",
    show_alert: false,
  });
}

/**
 * Edits the text of an existing message.
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  newText: string,
  inlineKeyboard?: any
): Promise<void> {
  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    parse_mode: "HTML",
  };
  
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  await callTelegramApi("editMessageText", payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts plain email from "Name <email@domain.com>" format */
function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}

/** Escapes HTML special characters for Telegram HTML parse_mode */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
