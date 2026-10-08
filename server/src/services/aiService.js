// SERVER-SIDE AI DECISION SUPPORT. The API key is read from the environment and never leaves this process.
// The AI explains and recommends; it never decides the numbers (shelf life, risk and prices come from the engines).
//
//   build input -> call model -> validate -> [one retry if invalid/transient] -> else deterministic fallback
//
// generateInsight() never throws: whatever happens, the pipeline gets a valid 5-field analysis back.
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { aiCalls } from '../database/repositories.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage, retryNote } from '../ai/prompt.js';
import { buildAiInput } from '../ai/aiInput.js';
import { validateAiOutput, AiOutputError } from '../ai/aiValidator.js';
import { fallbackAnalysis } from '../ai/aiFallback.js';

export { PROMPT_VERSION };
export const aiConfigured = () => Boolean(config.ai.apiKey);

// Kept for callers that only have the pipeline context (not the AI input).
export const fallbackInsight = (ctx) => fallbackAnalysis(buildAiInput(ctx));

class ProviderError extends Error {
  constructor(message, { type, retryable }) { super(message); this.name = 'ProviderError'; this.type = type; this.retryable = retryable; }
}

// Redact the key if it ever appears in an error string, and keep messages short.
const safe = (msg) => {
  let m = String(msg ?? '');
  if (config.ai.apiKey) m = m.replaceAll(config.ai.apiKey, '[REDACTED]');
  return m.slice(0, 200);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const elapsed = (t0) => Number((process.hrtime.bigint() - t0) / 1_000_000n);

async function callModel(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(config.ai.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.ai.model, max_tokens: 700, system: SYSTEM_PROMPT, messages }),
    });
    if (!res.ok) {
      // 429 and 5xx are transient (retry once). 4xx such as 401/400 will not fix themselves.
      const transient = res.status === 429 || res.status >= 500;
      throw new ProviderError(`AI provider returned HTTP ${res.status}`, { type: 'http_error', retryable: transient });
    }
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err.name === 'AbortError') throw new ProviderError(`AI call timed out after ${config.ai.timeoutMs}ms`, { type: 'timeout', retryable: false }); // do not double the wait
    throw new ProviderError(err.message || 'network error', { type: 'network', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function record(call) {
  try { aiCalls.insert(call); }
  catch (err) { logger.error({ operation: 'ai.telemetry_persist', shipmentId: call.shipmentId ?? null, result: 'error', error: { message: safe(err.message) } }); }
  logger.info({
    operation: 'ai.request', shipmentId: call.shipmentId ?? null, model: call.model, promptVersion: call.promptVersion,
    status: call.status, failureType: call.failureType ?? null, success: call.success, attempts: call.attempts, latencyMs: call.latencyMs,
    ...(call.error ? { error: call.error } : {}),
  });
}

export async function generateInsight(ctx) {
  const t0 = process.hrtime.bigint();
  const input = buildAiInput(ctx);
  const base = { shipmentId: ctx.shipment.id, telemetryId: ctx.telemetryId ?? null, model: config.ai.model, promptVersion: PROMPT_VERSION };
  const finish = (r) => { record({ ...base, status: r.status, failureType: r.failureType, success: r.status === 'ok', attempts: r.attempts, latencyMs: r.latencyMs, error: r.error }); return r; };
  const fallback = (status, extra) => ({
    status, source: 'fallback-template', model: status === 'skipped' ? null : config.ai.model, promptVersion: PROMPT_VERSION,
    insight: fallbackAnalysis(input), ...extra,
  });

  if (!aiConfigured()) {
    return finish(fallback('skipped', { attempts: 0, latencyMs: elapsed(t0), failureType: 'no_api_key', error: 'AI key not configured' }));
  }

  const messages = [{ role: 'user', content: buildUserMessage(input) }];
  const maxAttempts = 1 + config.ai.maxRetries;
  let lastErr = null, lastText = '', attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    const a0 = process.hrtime.bigint();
    try {
      const text = await callModel(messages);
      lastText = text;
      const insight = validateAiOutput(text, input);
      logger.info({ operation: 'ai.attempt', shipmentId: base.shipmentId, attempt: attempts, result: 'valid', latencyMs: elapsed(a0) });
      return finish({ status: 'ok', source: 'claude', model: config.ai.model, promptVersion: PROMPT_VERSION, insight, error: null, failureType: null, attempts, latencyMs: elapsed(t0) });
    } catch (err) {
      lastErr = err;
      const invalid = err instanceof AiOutputError;
      logger.warn({ operation: 'ai.attempt', shipmentId: base.shipmentId, attempt: attempts, result: invalid ? 'invalid_output' : err.type || 'error', latencyMs: elapsed(a0), error: { message: safe(err.message) } });
      const retryable = invalid || err.retryable;
      if (!retryable || attempts >= maxAttempts) break;
      if (invalid) messages.push({ role: 'assistant', content: String(lastText).slice(0, 1500) || '(empty reply)' }, { role: 'user', content: retryNote(err.message) });
      else await sleep(250);
    }
  }

  const failureType = lastErr instanceof AiOutputError ? 'invalid_output' : lastErr?.type || 'error';
  return finish(fallback('failed', { attempts, latencyMs: elapsed(t0), failureType, error: safe(lastErr?.message) }));
}
