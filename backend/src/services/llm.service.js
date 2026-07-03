/**
 * LLM Service
 * -----------
 * Wraps calls to an OpenAI-compatible chat completions endpoint.
 * Designed so LLM failures NEVER break the booking/consultation flow:
 *  - network/API errors are caught and a safe fallback summary is returned
 *  - if no API key is configured, a deterministic mock summarizer runs instead
 *  - every call result records whether it was AI-generated or a fallback,
 *    so the frontend can show "AI summary unavailable, showing raw notes".
 */

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

async function callLLM(systemPrompt, userPrompt) {
  if (!LLM_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`LLM_HTTP_${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch {
    return null;
  }
}

// --- Pre-visit summary --------------------------------------------------
const PRE_VISIT_SYSTEM = `You are a clinical triage assistant. Analyse patient-reported
symptoms and respond ONLY with strict JSON of the form:
{"urgency":"Low|Medium|High","chief_complaint":"...","questions":["q1","q2","q3"]}
No markdown, no extra text.`;

async function generatePreVisitSummary(symptomsText) {
  const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptomsText}`;
  try {
    const raw = await callLLM(PRE_VISIT_SYSTEM, prompt);
    const parsed = safeJsonParse(raw);
    if (parsed && parsed.urgency && parsed.chief_complaint) {
      return { ...parsed, source: 'ai' };
    }
    throw new Error('LLM_BAD_FORMAT');
  } catch (err) {
    // Deterministic fallback so the doctor still gets something useful
    return {
      urgency: guessUrgencyFromKeywords(symptomsText),
      chief_complaint: symptomsText.slice(0, 140),
      questions: [
        'When did the symptoms start and how have they changed?',
        'Any relevant medical history or current medications?',
        'Is there anything that makes the symptoms better or worse?',
      ],
      source: 'fallback',
      fallback_reason: err.message,
    };
  }
}

function guessUrgencyFromKeywords(text) {
  const t = text.toLowerCase();
  const high = ['chest pain', 'difficulty breathing', 'severe', 'unconscious', 'bleeding heavily'];
  const medium = ['fever', 'vomiting', 'persistent pain', 'dizziness'];
  if (high.some((k) => t.includes(k))) return 'High';
  if (medium.some((k) => t.includes(k))) return 'Medium';
  return 'Low';
}

// --- Post-visit summary --------------------------------------------------
const POST_VISIT_SYSTEM = `You are a medical communication assistant. Convert clinical
notes into a warm, plain-language summary a patient can easily understand, including
a medication schedule and follow-up steps. Keep it under 200 words. Respond in plain text.`;

async function generatePostVisitSummary(clinicalNotes) {
  const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${clinicalNotes}`;
  try {
    const raw = await callLLM(POST_VISIT_SYSTEM, prompt);
    if (raw) return { text: raw, source: 'ai' };
    throw new Error('LLM_EMPTY_RESPONSE');
  } catch (err) {
    return {
      text: `Here is a summary of your visit:\n\n${clinicalNotes}\n\nPlease follow your prescribed medication schedule and contact the clinic if symptoms persist or worsen.`,
      source: 'fallback',
      fallback_reason: err.message,
    };
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };
