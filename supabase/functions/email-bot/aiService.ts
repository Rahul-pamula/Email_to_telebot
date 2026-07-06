// ============================================================================
// aiService.ts — Groq AI Summarization & Importance Classification
// Phase 5
// ============================================================================


import { config } from "./config.ts";
import { AiResult } from "./types.ts";

// Groq follows the OpenAI REST API format — no SDK needed, just fetch().
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt — carefully engineered to:
//  1. First decide IMPORTANT vs ROUTINE (acts as a pre-filter to save tokens).
//  2. Only if important, produce a strict 3-bullet summary.
//  3. Return a structured JSON response so we can parse it reliably.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an intelligent email assistant. Your job is to classify emails and summarize them.

STEP 1 — CLASSIFY the email as one of:
- "IMPORTANT": Requires attention or action (e.g., work tasks, deadlines, financial, personal matters from real people, job offers).
- "ROUTINE": MUST be ignored (e.g., Google Security alerts, new device logins, newsletters, promotions, automated reports, social media notifications, OTP codes).

IF THE EMAIL IS A "Google Security Alert" OR "Your verification is past due" OR SIMILAR AUTOMATED PLATFORM ALERT, YOU MUST CLASSIFY IT AS "ROUTINE".

CRITICAL EXCEPTION: Any emails regarding Job Opportunities, Placement Drives, Interview Schedules, or University Announcements MUST ALWAYS be classified as 'IMPORTANT', even if they are automated or bulk emails.

STEP 2 — If "IMPORTANT", write exactly 2 short bullet points summarizing the key information.
Each bullet must be under 100 characters and start with an emoji that matches the tone.

RESPOND ONLY with valid JSON in this exact format (no extra text, no markdown backticks):
{
  "classification": "IMPORTANT" | "ROUTINE",
  "summary": ["• bullet 1", "• bullet 2"] | null
}`;

/**
 * Sends an email to Groq's Llama 3 model for importance classification
 * and summarization.
 */
export async function analyzeEmail(
  from: string,
  subject: string,
  body: string
): Promise<AiResult> {
  const userMessage = `FROM: ${from}\nSUBJECT: ${subject}\n\nBODY:\n${body}`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.groq.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groq.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.0, // Force completely deterministic output
        max_tokens: 300,
      }),
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
        // Ignore JSON parse error, use fallback
      }
      
      return { isImportant: true, summary: `⚠️ AI Analysis failed: ${errMsg}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("[AI] Groq returned empty content.");
      return { isImportant: true, summary: "⚠️ AI returned empty content." };
    }

    // Strip markdown JSON wrappers if the LLM hallucinates them despite response_format
    const cleanContent = content.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleanContent);
    const isImportant = parsed?.classification === "IMPORTANT";
    
    let bulletPoints = parsed?.summary;
    let validSummary: string | null = null;
    
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
      summary: validSummary || (isImportant ? "⚠️ AI failed to generate summary." : null) 
    };
  } catch (err) {
    console.error("[AI] Unexpected error during analysis:", err);
    // Fail open: treat as important if we can't reach the AI
    return { isImportant: true, summary: "⚠️ AI Analysis failed (Unexpected Error)." };
  }
}
