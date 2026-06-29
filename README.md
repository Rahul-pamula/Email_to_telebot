# 📧 Email to Telegram AI Summary Bot

![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Deno](https://img.shields.io/badge/Deno-white?style=for-the-badge&logo=deno&logoColor=464647)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_Llama_3-f55036?style=for-the-badge)

A powerful, serverless bot that monitors your email inbox, uses cutting-edge AI (Groq Llama 3) to instantly classify whether an email is important or routine, and pushes a clean, 3-bullet summary directly to your Telegram.

Built entirely on **Supabase Edge Functions** to run 24/7 in the cloud for absolutely **zero cost**.

---

## ✨ Features

- **🧠 Smart AI Filtering:** Automatically ignores newsletters, promotions, and routine emails. Only alerts you when an email actually requires your attention (deadlines, financial, urgent tasks).
- **📝 Bite-Sized Summaries:** Important emails are instantly summarized into 3 quick bullet points. No more reading long email threads.
- **🔐 Secure by Design:** Uses IMAP App Passwords encrypted at rest using **Supabase Vault**. Edge functions bypass attachments entirely (`BODY.PEEK[TEXT]`) to respect 50MB memory limits and ensure high performance.
- **⚙️ Interactive Telegram UI:** Fully functional Telegram bot allowing you to:
  - `/add_email` to connect multiple inboxes (Gmail supported).
  - Press inline buttons to `🔕 Block Sender`, `🕒 Snooze`, or `📅 Remind Tomorrow`.
  - Mark specific senders as `/vip` to bypass AI filtering.
- **⚡ Serverless Architecture:** Runs entirely on Supabase Edge Functions (Deno) triggered by `pg_cron` (polling) and Telegram Webhooks (instant commands).

---

## 🛠 Tech Stack

- **Backend / Hosting:** Supabase (PostgreSQL, Edge Functions, pg_cron, Supabase Vault)
- **Language:** TypeScript (Deno runtime)
- **AI / LLM:** Groq API (Llama 3 8B model)
- **Bot Interface:** Telegram Bot API
- **Email Protocol:** IMAP (`imapflow` over SSL)

---

## 🏗 Architecture

1. **Telegram Webhook (`webhookHandler.ts`)**  
   Receives instant commands from the user (e.g., `/start`, `/add_email`). Handles the multi-step conversation state to securely store the user's Gmail App Password in Supabase Vault.
2. **Cron Trigger (`emailPoller.ts`)**  
   Runs every 5 minutes via `pg_cron`. Connects to your email via IMAP, fetches unread text bodies, and passes them to the AI.
3. **AI Engine (`aiService.ts`)**  
   Prompts Groq Llama 3 to classify the email (`IMPORTANT` vs `ROUTINE`). If important, returns a strict 3-bullet JSON summary.
4. **Delivery (`telegram.ts`)**  
   Pushes the AI summary to the user's Telegram chat along with interactive Inline Keyboard Buttons.

---

## 🚀 Quick Start & Deployment

Want to deploy your own instance for free? We have prepared a step-by-step deployment guide.

👉 **[Read the Deployment Guide](./Docs/DEPLOYMENT.md)**

---

## 🔒 Privacy & Security

- Your email App Password is **never** stored in plain text. It is encrypted via `pgcrypto` inside **Supabase Vault** and decrypted only in memory during the IMAP fetch.
- Emails are **not stored** in the database. The system only stores the `message_id`, sender, and subject to prevent duplicate notifications.
- The Edge Function enforces strict RLS (Row Level Security) fallback policies, though it operates internally via the Service Role Key.

---

_Built with ❤️ for a cleaner inbox._
