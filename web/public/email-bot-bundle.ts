// ../supabase/functions/email-bot/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ../supabase/functions/email-bot/config.ts
function requireEnv(key) {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(
      `[Config] Missing required environment variable: ${key}. Please set it via 'supabase secrets set ${key}=...'`
    );
  }
  return value;
}
var config = {
  // Telegram Bot credentials
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET")
  },
  // Groq AI API
  groq: {
    apiKey: requireEnv("GROQ_API_KEY"),
    // Llama 3.1 8B: Fast and efficient for classification + summarization
    model: "llama-3.1-8b-instant",
    // Max tokens to send to Groq — prevents hitting context limits
    maxEmailTokens: 3e3
  },
  // Supabase (service role for privileged DB access — bypasses RLS)
  supabase: {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  },
  // Email processing limits
  email: {
    // Max emails to process per account per cron run
    batchSize: 5
  }
};

// ../supabase/functions/email-bot/telegram.ts
var TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;
async function callTelegramApi(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[Telegram] API error on ${method}:`, err);
  }
}
async function sendMessage(chatId, text) {
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  });
}
async function sendInteractiveMenu(chatId, text, inlineKeyboard) {
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}
async function sendSummary(chatId, from, subject, emailAddress, summary, messageId) {
  const senderEmail = extractEmail(from);
  const text = `\u{1F4E7} <b>New Important Email</b>
<b>From:</b> ${escapeHtml(from)}
<b>Account:</b> ${escapeHtml(emailAddress)}
<b>Subject:</b> ${escapeHtml(subject)}

${escapeHtml(summary)}`;
  const shortId = btoa(messageId).substring(0, 20).replace(/[+=\/]/g, "");
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "\u2197\uFE0F Open in Inbox", url: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}` }
      ],
      [
        { text: "\u{1F515} Mute this user", callback_data: `blk:${senderEmail}`.substring(0, 64) },
        { text: "\u2B50 Add to VIP", callback_data: `vip:${senderEmail}`.substring(0, 64) }
      ],
      [
        { text: "\u{1F552} Remind later", callback_data: `s1h:${shortId}` }
      ]
    ]
  };
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: inlineKeyboard
  });
}
async function answerCallbackQuery(callbackQueryId, text) {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "\u2705 Done!",
    show_alert: false
  });
}
async function editMessageText(chatId, messageId, newText, inlineKeyboard) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    parse_mode: "HTML"
  };
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  await callTelegramApi("editMessageText", payload);
}
function extractEmail(from) {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}
function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ../supabase/functions/email-bot/webhookHandler.ts
async function handleWebhook(update, supabase) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, supabase);
    return;
  }
  if (update.message?.text) {
    await handleMessage(update.message, supabase);
    return;
  }
  console.log("[Webhook] Received update with no actionable content.");
}
async function handleMessage(message, supabase) {
  if (!message.text) return;
  const chatId = message.chat.id;
  const telegramId = message.from.id;
  const text = message.text.trim();
  const isApproved = await upsertUserAndCheckApproval(supabase, message.from);
  if (!isApproved) {
    await handleUnapprovedUser(chatId, telegramId, message.from, supabase);
    return;
  }
  const pendingAction = await getPendingAction(supabase, telegramId);
  if (pendingAction) {
    await handleStatefulInput(text, chatId, telegramId, pendingAction, supabase);
    return;
  }
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
    await sendMessage(chatId, "\u2753 Unknown command. Type /help to see all available commands.");
  }
}
async function handleCallbackQuery(callbackQuery, supabase) {
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const telegramId = callbackQuery.from.id;
  const data = callbackQuery.data || "";
  if (!chatId || !messageId) return;
  if (data.startsWith("approve:") || data.startsWith("deny:")) {
    const isApprove = data.startsWith("approve:");
    const targetId = parseInt(data.split(":")[1], 10);
    const { data: adminCheck } = await supabase.from("users").select("is_admin").eq("telegram_id", telegramId).single();
    if (adminCheck?.is_admin) {
      if (isApprove) {
        await supabase.from("users").update({ is_approved: true }).eq("telegram_id", targetId);
        await editMessageText(chatId, messageId, `\u2705 <b>Approved access</b> for user ID: ${targetId}`);
        await sendMessage(targetId, "\u{1F389} <b>Your access has been approved!</b>\nSend /start to begin.");
      } else {
        await editMessageText(chatId, messageId, `\u274C <b>Denied access</b> for user ID: ${targetId}`);
        await sendMessage(targetId, "\u26D4\uFE0F Your request for access was denied by the Admin.");
      }
      await answerCallbackQuery(callbackQuery.id, isApprove ? "Approved" : "Denied");
    } else {
      await answerCallbackQuery(callbackQuery.id, "Unauthorized. You are not an admin.");
    }
    return;
  }
  if (data.startsWith("blk:")) {
    const senderEmail = data.replace("blk:", "").trim();
    await supabase.from("blocklist").upsert({
      user_telegram_id: telegramId,
      sender_email: senderEmail
    });
    await answerCallbackQuery(callbackQuery.id, `\u{1F515} Muted ${senderEmail}`);
    await editMessageText(chatId, messageId, `\u{1F515} <b>Sender muted</b>: <code>${escapeHtml(senderEmail)}</code>
You won't receive summaries from this sender anymore.`);
  } else if (data.startsWith("vip:")) {
    const senderEmail = data.replace("vip:", "").trim();
    await supabase.from("vip_list").upsert({
      user_telegram_id: telegramId,
      sender_email: senderEmail
    });
    await answerCallbackQuery(callbackQuery.id, `\u2B50 Added ${senderEmail} to VIP`);
    await editMessageText(chatId, messageId, `\u2B50 <b>Sender added to VIP</b>: <code>${escapeHtml(senderEmail)}</code>
You will always receive immediate notifications from this sender without AI filtering.`);
  } else if (data.startsWith("s1h:")) {
    const snoozeUntil = new Date(Date.now() + 60 * 60 * 1e3).toISOString();
    await supabase.from("user_preferences").upsert({
      user_telegram_id: telegramId,
      snooze_until: snoozeUntil
    });
    await answerCallbackQuery(callbackQuery.id, "\u{1F552} Remind later (1 hour)");
    await editMessageText(chatId, messageId, "\u{1F552} <b>Notifications snoozed for 1 hour.</b>\nI'll resume sending summaries after that.");
  } else if (data.startsWith("rm_em:")) {
    const email = data.replace("rm_em:", "").trim();
    if (email === "cancel") {
      await answerCallbackQuery(callbackQuery.id);
      await editMessageText(chatId, messageId, "Action cancelled.");
      return;
    }
    const { error } = await supabase.from("email_accounts").delete().eq("user_telegram_id", telegramId).eq("email_address", email.toLowerCase());
    if (error) {
      await answerCallbackQuery(callbackQuery.id, "\u274C Failed to remove.");
    } else {
      await answerCallbackQuery(callbackQuery.id, `\u2705 Disconnected ${email}`);
      await editMessageText(chatId, messageId, `\u2705 <b>${escapeHtml(email)}</b> has been securely disconnected.`);
    }
  } else if (data === "settings_main") {
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = [
      [{ text: "\u{1F6AB} Manage Blocked Senders", callback_data: "settings_block" }],
      [{ text: "\u2B50 Manage VIPs", callback_data: "settings_vip" }],
      [{ text: "\u23F0 Clear Active Snoozes", callback_data: "clear_snooze" }]
    ];
    await editMessageText(chatId, messageId, "\u2699\uFE0F <b>Your Preferences</b>\nSelect a category below:", keyboard);
  } else if (data === "settings_block") {
    const { data: blocked } = await supabase.from("blocklist").select("sender_email").eq("user_telegram_id", telegramId);
    if (!blocked || blocked.length === 0) {
      await answerCallbackQuery(callbackQuery.id, "No blocked senders.");
      await editMessageText(chatId, messageId, "\u{1F515} You don't have any blocked senders.", [[{ text: "\u{1F519} Back to Settings", callback_data: "settings_main" }]]);
      return;
    }
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = blocked.map((b) => [{ text: `\u2705 Unblock ${b.sender_email}`, callback_data: `rm_blk:${b.sender_email}`.substring(0, 64) }]);
    keyboard.push([{ text: "\u{1F519} Back to Settings", callback_data: "settings_main" }]);
    await editMessageText(chatId, messageId, "\u{1F515} <b>Blocked Senders</b>\nTap to unblock:", keyboard);
  } else if (data.startsWith("rm_blk:")) {
    const email = data.replace("rm_blk:", "").trim();
    await supabase.from("blocklist").delete().eq("user_telegram_id", telegramId).eq("sender_email", email);
    await answerCallbackQuery(callbackQuery.id, `Unblocked ${email}`);
    callbackQuery.data = "settings_block";
    await handleCallbackQuery(callbackQuery, supabase);
  } else if (data === "settings_vip") {
    const { data: vips } = await supabase.from("vip_list").select("sender_email").eq("user_telegram_id", telegramId);
    if (!vips || vips.length === 0) {
      await answerCallbackQuery(callbackQuery.id, "No VIP senders.");
      await editMessageText(chatId, messageId, "\u2B50 You don't have any VIP senders.\n<i>(VIP senders bypass AI filtering and always notify you.)</i>", [[{ text: "\u{1F519} Back to Settings", callback_data: "settings_main" }]]);
      return;
    }
    await answerCallbackQuery(callbackQuery.id);
    const keyboard = vips.map((v) => [{ text: `\u274C Remove VIP ${v.sender_email}`, callback_data: `rm_vip:${v.sender_email}`.substring(0, 64) }]);
    keyboard.push([{ text: "\u{1F519} Back to Settings", callback_data: "settings_main" }]);
    await editMessageText(chatId, messageId, "\u2B50 <b>VIP Senders</b>\nTap to remove from VIPs:", keyboard);
  } else if (data.startsWith("rm_vip:")) {
    const email = data.replace("rm_vip:", "").trim();
    await supabase.from("vip_list").delete().eq("user_telegram_id", telegramId).eq("sender_email", email);
    await answerCallbackQuery(callbackQuery.id, `Removed ${email} from VIPs`);
    callbackQuery.data = "settings_vip";
    await handleCallbackQuery(callbackQuery, supabase);
  } else if (data === "clear_snooze") {
    await supabase.from("user_preferences").update({ snooze_until: null }).eq("user_telegram_id", telegramId);
    await answerCallbackQuery(callbackQuery.id, "Snoozes cleared!");
    await editMessageText(chatId, messageId, "\u23F0 <b>All snoozes cleared.</b> Notifications are active.", [[{ text: "\u{1F519} Back to Settings", callback_data: "settings_main" }]]);
  } else {
    await answerCallbackQuery(callbackQuery.id, "Action completed.");
  }
}
async function handleStart(chatId, firstName) {
  await sendMessage(
    chatId,
    `\u{1F44B} Welcome, <b>${escapeHtml(firstName)}</b>!

I'm your personal <b>Email Summary Bot</b>. I'll monitor your inbox and send you smart AI summaries of important emails \u2014 right here in Telegram.

<b>Get started:</b>
\u2022 /add_email \u2014 Connect your first inbox
\u2022 /help \u2014 See all available commands

<i>I'm 100% free, private, and open-source.</i>`
  );
}
async function handleHelp(chatId) {
  await sendMessage(
    chatId,
    `\u{1F4D6} <b>Available Commands</b>

<b>\u{1F4E7} Email Management</b>
/add_email \u2014 Connect a new email inbox
/list_emails \u2014 View connected inboxes
/remove_email \u2014 Disconnect an inbox interactively

<b>\u2699\uFE0F Preferences</b>
/settings \u2014 Manage Blocked Senders, VIPs, and Snoozes

<b>\u23F0 Notifications</b>
/digest \u2014 Get a summary of today's important emails`
  );
}
async function handleAddEmailStart(chatId, telegramId, supabase) {
  await setPendingAction(supabase, telegramId, { type: "await_email" });
  await sendMessage(
    chatId,
    `\u{1F4E7} <b>Add Email Account</b>

Please send me your email address.
<i>Example: yourname@gmail.com</i>`
  );
}
async function handleListEmails(chatId, telegramId, supabase) {
  const { data: accounts } = await supabase.from("email_accounts").select("email_address, is_active").eq("user_telegram_id", telegramId);
  if (!accounts || accounts.length === 0) {
    await sendMessage(chatId, "\u{1F4ED} No email accounts connected yet. Use /add_email to add one.");
    return;
  }
  const list = accounts.map(
    (a, i) => `${i + 1}. <code>${escapeHtml(a.email_address)}</code> ${a.is_active ? "\u2705" : "\u23F8"}`
  ).join("\n");
  await sendMessage(chatId, `\u{1F4E7} <b>Your Connected Inboxes:</b>

${list}`);
}
async function handleRemoveEmailInteractive(chatId, telegramId, supabase) {
  const { data: accounts } = await supabase.from("email_accounts").select("email_address").eq("user_telegram_id", telegramId);
  if (!accounts || accounts.length === 0) {
    await sendMessage(chatId, "\u{1F4ED} You don't have any connected email accounts to remove.");
    return;
  }
  const keyboard = accounts.map((a) => [
    { text: `\u274C Disconnect ${a.email_address}`, callback_data: `rm_em:${a.email_address}`.substring(0, 64) }
  ]);
  keyboard.push([{ text: "\u{1F519} Cancel", callback_data: "rm_em:cancel" }]);
  await sendInteractiveMenu(chatId, "\u{1F5D1} <b>Which account would you like to disconnect?</b>\n<i>This will securely remove it and its App Password from the system.</i>", keyboard);
}
async function handleSettingsMenu(chatId, telegramId, supabase) {
  const keyboard = [
    [{ text: "\u{1F6AB} Manage Blocked Senders", callback_data: "settings_block" }],
    [{ text: "\u2B50 Manage VIPs", callback_data: "settings_vip" }],
    [{ text: "\u23F0 Clear Active Snoozes", callback_data: "clear_snooze" }]
  ];
  await sendInteractiveMenu(chatId, "\u2699\uFE0F <b>Your Preferences</b>\nSelect a category below:", keyboard);
}
async function handleDigest(chatId, telegramId, supabase) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
  const { data: summaries } = await supabase.from("processed_emails").select("subject, sender, summary, processed_at").gte("processed_at", since).not("summary", "is", null).order("processed_at", { ascending: false });
  if (!summaries || summaries.length === 0) {
    await sendMessage(chatId, "\u{1F4ED} No important emails in the last 24 hours.");
    return;
  }
  let text = `\u{1F4CA} <b>Your Digest</b> \u2014 last 24 hours (${summaries.length} important)

`;
  for (const [i, s] of summaries.entries()) {
    text += `<b>${i + 1}. ${escapeHtml(s.subject)}</b>
<i>From: ${escapeHtml(s.sender)}</i>
${escapeHtml(s.summary)}

`;
  }
  await sendMessage(chatId, text);
}
async function handleStatefulInput(text, chatId, telegramId, pending, supabase) {
  if (text.startsWith("/")) {
    await clearPendingAction(supabase, telegramId);
    await sendMessage(chatId, "\u274C Action cancelled. Type /help to see all commands.");
    return;
  }
  if (pending.type === "await_email") {
    if (!text.includes("@") || !text.includes(".")) {
      await sendMessage(chatId, "\u26A0\uFE0F That doesn't look like a valid email. Please try again:");
      return;
    }
    await setPendingAction(supabase, telegramId, {
      type: "await_password",
      email: text.toLowerCase().trim()
    });
    await sendMessage(
      chatId,
      `\u2705 Got it: <code>${escapeHtml(text)}</code>

Now, please send me your <b>Gmail App Password</b>.

<i>How to get one:</i>
1. Go to myaccount.google.com
2. Security \u2192 2-Step Verification \u2192 App passwords
3. Create a new one and paste the 16-character code here.

\u26A0\uFE0F <b>Delete this message after sending for safety.</b>`
    );
    return;
  }
  if (pending.type === "await_password" && pending.email) {
    const appPassword = text.replace(/\s/g, "");
    if (appPassword.length < 16) {
      await sendMessage(chatId, "\u26A0\uFE0F App Password seems too short. Gmail App Passwords are 16 characters. Please try again:");
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
        `\u{1F389} <b>${escapeHtml(pending.email)}</b> has been connected successfully!

I'll start monitoring your inbox and send you summaries of important emails.
The first check will happen within 5 minutes.

<i>Please delete your message containing the App Password from this chat.</i>`
      );
    } else {
      await sendMessage(chatId, `\u274C Failed to connect <b>${escapeHtml(pending.email)}</b>. Please try /add_email again.`);
    }
  }
}
async function upsertUserAndCheckApproval(supabase, from) {
  const { data: existingUser } = await supabase.from("users").select("is_approved").eq("telegram_id", from.id).single();
  if (existingUser) {
    await supabase.from("users").update({
      first_name: from.first_name,
      username: from.username || null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("telegram_id", from.id);
    return existingUser.is_approved;
  }
  const { count } = await supabase.from("users").select("*", { count: "exact", head: true });
  const isFirstUser = count === 0;
  await supabase.from("users").insert({
    telegram_id: from.id,
    first_name: from.first_name,
    username: from.username || null,
    is_admin: isFirstUser,
    is_approved: isFirstUser
    // Admin is auto-approved
  });
  return isFirstUser;
}
async function handleUnapprovedUser(chatId, telegramId, from, supabase) {
  await sendMessage(chatId, "\u26D4\uFE0F <b>Access restricted.</b>\nThis is a private bot instance. Your request for access has been forwarded to the Admin.");
  const { data: admins } = await supabase.from("users").select("telegram_id").eq("is_admin", true).limit(1);
  if (admins && admins.length > 0) {
    const adminId = admins[0].telegram_id;
    const userDisplay = from.username ? `@${from.username}` : from.first_name;
    const keyboard = [
      [{ text: "\u2705 Approve", callback_data: `approve:${telegramId}` }],
      [{ text: "\u274C Deny", callback_data: `deny:${telegramId}` }]
    ];
    await sendInteractiveMenu(adminId, `\u{1F514} <b>New Access Request</b>
User ${escapeHtml(userDisplay)} (ID: ${telegramId}) wants to use the bot.`, keyboard);
  }
}
async function getPendingAction(supabase, telegramId) {
  const { data } = await supabase.from("user_preferences").select("pending_action").eq("user_telegram_id", telegramId).single();
  return data?.pending_action ?? null;
}
async function setPendingAction(supabase, telegramId, action) {
  await supabase.from("user_preferences").upsert({
    user_telegram_id: telegramId,
    pending_action: action
  });
}
async function clearPendingAction(supabase, telegramId) {
  await supabase.from("user_preferences").update({ pending_action: null }).eq("user_telegram_id", telegramId);
}
async function saveEmailAccount(supabase, telegramId, emailAddress, appPassword) {
  try {
    const { data: secretId, error: vaultError } = await supabase.rpc(
      "vault_create_secret",
      {
        secret: appPassword,
        name: `app_password_${telegramId}_${emailAddress}`
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
      is_active: true
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

// ../supabase/functions/email-bot/imapClient.ts
import { ImapFlow } from "npm:imapflow@1";
async function fetchUnseenEmails(emailAddress, appPassword, imapHost = "imap.gmail.com", imapPort = 993) {
  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: true,
    // Always use SSL/TLS — never plain text
    auth: {
      user: emailAddress,
      pass: appPassword
    },
    // Suppress verbose IMAP protocol logging in production
    logger: false
  });
  const emails = [];
  try {
    await client.connect();
    console.log(`[IMAP] Connected to ${imapHost} as ${emailAddress}`);
    const mailbox = await client.mailboxOpen("INBOX");
    console.log(`[IMAP] Mailbox has ${mailbox.exists} total messages.`);
    const unseenUids = await client.search({ seen: false });
    if (!unseenUids || unseenUids.length === 0) {
      console.log(`[IMAP] No unseen emails found for ${emailAddress}.`);
      return [];
    }
    console.log(`[IMAP] Found ${unseenUids.length} unseen email(s).`);
    const batchUids = unseenUids.slice(-config.email.batchSize);
    for await (const message of client.fetch(batchUids, {
      uid: true,
      envelope: true,
      // Contains: from, subject, messageId, date
      bodyParts: ["TEXT"]
      // Only plain text — no attachments downloaded
    })) {
      try {
        const from = message.envelope?.from?.[0];
        const fromAddress = from ? `${from.name || ""} <${from.address || "unknown"}>`.trim() : "Unknown Sender";
        const subject = message.envelope?.subject || "(No Subject)";
        const messageId = message.envelope?.messageId || `uid-${message.uid}`;
        const rawBody = message.bodyParts?.get("TEXT") || "";
        const textBody = cleanEmailBody(rawBody.toString());
        const charLimit = config.groq.maxEmailTokens * 2;
        const truncatedBody = textBody.length > charLimit ? textBody.substring(0, charLimit) + "\n\n[... email truncated ...]" : textBody;
        emails.push({
          messageId,
          from: fromAddress,
          subject,
          body: truncatedBody
        });
      } catch (parseErr) {
        console.warn(`[IMAP] Failed to parse a message, skipping:`, parseErr);
      }
    }
    console.log(`[IMAP] Successfully parsed ${emails.length} email(s).`);
    return emails;
  } catch (err) {
    console.error(`[IMAP] Connection or fetch error for ${emailAddress}:`, err);
    return [];
  } finally {
    try {
      await client.logout();
      console.log(`[IMAP] Connection closed for ${emailAddress}.`);
    } catch {
    }
  }
}
function cleanEmailBody(raw) {
  return raw.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ../supabase/functions/email-bot/aiService.ts
var GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
var SYSTEM_PROMPT = `You are an intelligent email assistant. Your job is to classify emails and summarize them.

STEP 1 \u2014 CLASSIFY the email as one of:
- "IMPORTANT": Requires attention or action (e.g., work tasks, deadlines, financial, personal matters from real people, job offers).
- "ROUTINE": MUST be ignored (e.g., Google Security alerts, new device logins, newsletters, promotions, automated reports, social media notifications, OTP codes).

IF THE EMAIL IS A "Google Security Alert" OR "Your verification is past due" OR SIMILAR AUTOMATED PLATFORM ALERT, YOU MUST CLASSIFY IT AS "ROUTINE".

CRITICAL EXCEPTION: Any emails regarding Job Opportunities, Placement Drives, Interview Schedules, or University Announcements MUST ALWAYS be classified as 'IMPORTANT', even if they are automated or bulk emails.

STEP 2 \u2014 If "IMPORTANT", write exactly 2 short bullet points summarizing the key information.
Each bullet must be under 100 characters and start with an emoji that matches the tone.

RESPOND ONLY with valid JSON in this exact format (no extra text, no markdown backticks):
{
  "classification": "IMPORTANT" | "ROUTINE",
  "summary": ["\u2022 bullet 1", "\u2022 bullet 2"] | null
}`;
async function analyzeEmail(from, subject, body) {
  const userMessage = `FROM: ${from}
SUBJECT: ${subject}

BODY:
${body}`;
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.groq.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.groq.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        // Force completely deterministic output
        max_tokens: 300
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI] Groq API error ${response.status}:`, errorText);
      let errMsg = `API Error ${response.status}`;
      try {
        const errJson = JSON.parse(errorText);
        if (errJson.error?.message) {
          errMsg = errJson.error.message;
        }
      } catch (e) {
      }
      return { isImportant: true, summary: `\u26A0\uFE0F AI Analysis failed: ${errMsg}` };
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.warn("[AI] Groq returned empty content.");
      return { isImportant: true, summary: "\u26A0\uFE0F AI returned empty content." };
    }
    const cleanContent = content.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleanContent);
    const isImportant = parsed?.classification === "IMPORTANT";
    let bulletPoints = parsed?.summary;
    let validSummary = null;
    if (isImportant && bulletPoints) {
      if (Array.isArray(bulletPoints) && bulletPoints.length > 0) {
        validSummary = bulletPoints.join("\n");
      } else if (typeof bulletPoints === "string") {
        validSummary = bulletPoints;
      }
    }
    console.log(
      `[AI] Classification: ${parsed?.classification} | Subject: ${subject}`
    );
    return {
      isImportant,
      summary: validSummary || (isImportant ? "\u26A0\uFE0F AI failed to generate summary." : null)
    };
  } catch (err) {
    console.error("[AI] Unexpected error during analysis:", err);
    return { isImportant: true, summary: "\u26A0\uFE0F AI Analysis failed (Unexpected Error)." };
  }
}

// ../supabase/functions/email-bot/emailPoller.ts
async function runEmailPoller(supabase) {
  console.log("[Poller] Starting email polling cycle...");
  const { data: accounts, error: accountsError } = await supabase.from("email_accounts").select("*").eq("is_active", true);
  if (accountsError) {
    console.error("[Poller] Failed to fetch email accounts:", accountsError);
    return;
  }
  if (!accounts || accounts.length === 0) {
    console.log("[Poller] No active email accounts found. Exiting.");
    return;
  }
  console.log(`[Poller] Processing ${accounts.length} active account(s).`);
  for (const account of accounts) {
    try {
      await processAccount(account, supabase);
    } catch (err) {
      console.error(
        `[Poller] Error processing account ${account.email_address}:`,
        err
      );
    }
  }
  console.log("[Poller] Polling cycle complete.");
}
async function processAccount(account, supabase) {
  console.log(`[Poller] Processing account: ${account.email_address}`);
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
  const appPassword = secretData;
  const emails = await fetchUnseenEmails(
    account.email_address,
    appPassword,
    account.imap_host,
    account.imap_port
  );
  if (emails.length === 0) {
    return;
  }
  const { data: processedRows } = await supabase.from("processed_emails").select("message_id").eq("email_account_id", account.id);
  const processedIds = new Set(
    (processedRows || []).map((r) => r.message_id)
  );
  const { data: blockedRows } = await supabase.from("blocklist").select("sender_email").eq("user_telegram_id", account.user_telegram_id);
  const blockedSenders = new Set(
    (blockedRows || []).map(
      (r) => r.sender_email.toLowerCase()
    )
  );
  const { data: vipRows } = await supabase.from("vip_list").select("sender_email").eq("user_telegram_id", account.user_telegram_id);
  const vipSenders = new Set(
    (vipRows || []).map(
      (r) => r.sender_email.toLowerCase()
    )
  );
  for (const email of emails) {
    await processEmail(
      email,
      account,
      supabase,
      processedIds,
      blockedSenders,
      vipSenders
    );
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  await supabase.from("email_accounts").update({ last_polled_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", account.id);
}
async function processEmail(email, account, supabase, processedIds, blockedSenders, vipSenders) {
  if (processedIds.has(email.messageId)) {
    console.log(`[Poller] Skipping already-processed email: ${email.subject}`);
    return;
  }
  const senderEmail = extractEmail2(email.from).toLowerCase();
  if (blockedSenders.has(senderEmail)) {
    console.log(`[Poller] Skipping blocked sender: ${senderEmail}`);
    await logProcessed(supabase, email, account.id, null);
    return;
  }
  const { data: prefs } = await supabase.from("user_preferences").select("snooze_until").eq("user_telegram_id", account.user_telegram_id).single();
  const isSnoozed = prefs?.snooze_until && new Date(prefs.snooze_until) > /* @__PURE__ */ new Date();
  const isVip = vipSenders.has(senderEmail);
  let summary = null;
  if (!isVip) {
    const aiResult = await analyzeEmail(email.from, email.subject, email.body);
    if (!aiResult.isImportant) {
      console.log(`[Poller] AI classified as ROUTINE, skipping: ${email.subject}`);
      await logProcessed(supabase, email, account.id, null);
      return;
    }
    summary = aiResult.summary;
  } else {
    summary = `\u2B50 VIP sender \u2014 email not filtered by AI.
_Subject: ${email.subject}_`;
    console.log(`[Poller] VIP email from ${senderEmail}, bypassing AI.`);
  }
  if (isSnoozed) {
    await supabase.from("snooze_queue").insert({
      user_telegram_id: account.user_telegram_id,
      summary_text: `*${email.subject}*
_From: ${email.from}_
${summary ?? ""}`,
      scheduled_for: prefs.snooze_until
    });
    console.log(`[Poller] User is snoozed \u2014 summary queued for later.`);
    await logProcessed(supabase, email, account.id, summary);
    return;
  }
  await sendSummary(
    account.user_telegram_id,
    email.from,
    email.subject,
    account.email_address,
    summary ?? `\u26A0\uFE0F AI Summary unavailable.`,
    email.messageId
  );
  console.log(`[Poller] \u2705 Summary sent for: ${email.subject}`);
  await logProcessed(supabase, email, account.id, summary);
}
async function logProcessed(supabase, email, emailAccountId, summary) {
  const { error } = await supabase.from("processed_emails").upsert({
    message_id: email.messageId,
    email_account_id: emailAccountId,
    subject: email.subject,
    sender: email.from,
    summary
  });
  if (error) {
    console.warn("[Poller] Failed to log processed email:", error);
  }
}
function extractEmail2(from) {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}

// ../supabase/functions/email-bot/index.ts
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    { auth: { persistSession: false } }
  );
  const telegramSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (telegramSecret) {
    if (telegramSecret !== config.telegram.webhookSecret) {
      console.warn("[Router] Webhook received with invalid secret token.");
      return new Response("Forbidden: Invalid Secret", { status: 403 });
    }
    try {
      const update = await req.json();
      await handleWebhook(update, supabase);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("[Router] Error processing Telegram webhook:", err);
      return new Response("OK", { status: 200 });
    }
  }
  const cronTrigger = req.headers.get("x-cron-trigger");
  if (cronTrigger === "email-poller") {
    console.log("[Router] Cron triggered \u2014 starting email polling.");
    const pollingTask = runEmailPoller(supabase).catch((err) => {
      console.error("[Router] Error during background email polling:", err);
    });
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      EdgeRuntime.waitUntil(pollingTask);
    } else {
      console.warn("[Router] EdgeRuntime.waitUntil not found, running task un-awaited.");
    }
    return new Response(JSON.stringify({ status: "started" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  console.warn("[Router] Request received with no matching route headers.");
  return new Response("Bad Request", { status: 400 });
});
