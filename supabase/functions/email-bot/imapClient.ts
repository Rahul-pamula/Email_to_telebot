// ============================================================================
// imapClient.ts — Secure IMAP Email Fetcher
// ============================================================================
//
// Responsibilities:
//  1. Connect to the Gmail IMAP server over SSL using the user's App Password.
//  2. Search for UNSEEN (unread) emails only.
//  3. Fetch ONLY the text body using BODY.PEEK[TEXT] — attachments are
//     completely ignored to stay within the 50MB Edge Function memory limit.
//  4. Parse the raw IMAP response into a clean ParsedEmail object.
//  5. Limit the batch to config.email.batchSize (default: 5) per run.
//
// ============================================================================


import { config } from "./config.ts";
import { ParsedEmail } from "./types.ts";

// npm: specifier is the Deno-native way to import Node.js-compatible packages.
// ImapFlow uses Node's tls module which Deno supports via its Node compat layer.
// @ts-ignore: imapflow does not provide types but it works in Deno natively
import { ImapFlow } from "npm:imapflow@1";

/**
 * Fetches a batch of unread emails from a single email account.
 *
 * @param emailAddress - The user's email (e.g., user@gmail.com)
 * @param appPassword  - The decrypted App Password from Supabase Vault
 * @param imapHost     - IMAP server hostname (default: imap.gmail.com)
 * @param imapPort     - IMAP server port (default: 993)
 * @returns            - Array of ParsedEmail objects (max batchSize)
 */
export async function fetchUnseenEmails(
  emailAddress: string,
  appPassword: string,
  imapHost: string = "imap.gmail.com",
  imapPort: number = 993
): Promise<ParsedEmail[]> {
  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: true, // Always use SSL/TLS — never plain text
    auth: {
      user: emailAddress,
      pass: appPassword,
    },
    // Suppress verbose IMAP protocol logging in production
    logger: false,
  });

  const emails: ParsedEmail[] = [];

  try {
    // Establish the IMAP connection
    await client.connect();
    console.log(`[IMAP] Connected to ${imapHost} as ${emailAddress}`);

    // Open the INBOX in read-only mode first to count unseen messages
    const mailbox = await client.mailboxOpen("INBOX");
    console.log(`[IMAP] Mailbox has ${mailbox.exists} total messages.`);

    // Search for all UNSEEN message sequence numbers
    const unseenUids = await client.search({ seen: false });

    if (!unseenUids || unseenUids.length === 0) {
      console.log(`[IMAP] No unseen emails found for ${emailAddress}.`);
      return [];
    }

    console.log(`[IMAP] Found ${unseenUids.length} unseen email(s).`);

    // ───────────────────────────────────────────────────────────────────────
    // Batch Limiting: Take only the most recent N emails to avoid overload.
    // UIDs are ascending, so the last N are the most recent.
    // ───────────────────────────────────────────────────────────────────────
    const batchUids = unseenUids.slice(-config.email.batchSize);

    // ───────────────────────────────────────────────────────────────────────
    // Fetch ONLY text body and headers — BODY.PEEK does NOT mark as read.
    // This is critical: we never accidentally mark emails as read.
    // ───────────────────────────────────────────────────────────────────────
    for await (const message of client.fetch(batchUids, {
      uid: true,
      envelope: true,   // Contains: from, subject, messageId, date
      bodyParts: ["TEXT"], // Only plain text — no attachments downloaded
    })) {
      try {
        const from = message.envelope?.from?.[0];
        // ImapFlow uses from.address for the email address
        const fromAddress = from
          ? `${from.name || ""} <${from.address || "unknown"}>`.trim()
          : "Unknown Sender";

        const subject = message.envelope?.subject || "(No Subject)";
        const messageId = message.envelope?.messageId || `uid-${message.uid}`;

        // Get the raw text body and clean it up
        const rawBody = message.bodyParts?.get("TEXT") || "";
        const textBody = cleanEmailBody(rawBody.toString());

        // ─────────────────────────────────────────────────────────────────
        // Truncation Guard: Prevent sending huge emails to Groq's API.
        // If an email contains raw Base64/HTML, 1 char can equal 1 token.
        // We cap strictly at config.groq.maxEmailTokens * 2.
        // ─────────────────────────────────────────────────────────────────
        const charLimit = config.groq.maxEmailTokens * 2;
        const truncatedBody = textBody.length > charLimit
          ? textBody.substring(0, charLimit) + "\n\n[... email truncated ...]"
          : textBody;

        emails.push({
          messageId,
          from: fromAddress,
          subject,
          body: truncatedBody,
        });
      } catch (parseErr) {
        console.warn(`[IMAP] Failed to parse a message, skipping:`, parseErr);
      }
    }

    console.log(`[IMAP] Successfully parsed ${emails.length} email(s).`);
    return emails;
  } catch (err) {
    console.error(`[IMAP] Connection or fetch error for ${emailAddress}:`, err);
    // Return empty array on failure — the poller will handle the error gracefully
    return [];
  } finally {
    // Always close the connection to free up resources, even on error
    try {
      await client.logout();
      console.log(`[IMAP] Connection closed for ${emailAddress}.`);
    } catch {
      // Ignore logout errors
    }
  }
}

/**
 * Cleans up raw email body text by stripping HTML tags and excess whitespace.
 * Email bodies often contain HTML even when requested as TEXT.
 */
function cleanEmailBody(raw: string): string {
  return raw
    // Remove HTML tags
    .replace(/<[^>]*>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    // Collapse multiple whitespace/newlines into a single space or newline
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
