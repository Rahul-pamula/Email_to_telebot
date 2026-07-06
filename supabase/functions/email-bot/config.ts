// ============================================================================
// config.ts — Centralized configuration and environment variable validation
// ============================================================================



/**
 * Reads and validates all required environment variables at startup.
 * Throws a clear error if anything is missing, so we fail fast.
 */
function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(
      `[Config] Missing required environment variable: ${key}. ` +
        `Please set it via 'supabase secrets set ${key}=...'`
    );
  }
  return value;
}

export const config = {
  // Telegram Bot credentials
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  },

  // Groq AI API
  groq: {
    apiKey: requireEnv("GROQ_API_KEY"),
    // Llama 3.1 8B: Fast and efficient for classification + summarization
    model: "llama-3.1-8b-instant",
    // Max tokens to send to Groq — prevents hitting context limits
    maxEmailTokens: 3000,
  },

  // Supabase (service role for privileged DB access — bypasses RLS)
  supabase: {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  },

  // Email processing limits
  email: {
    // Max emails to process per account per cron run
    batchSize: 5,
  },
} as const;
