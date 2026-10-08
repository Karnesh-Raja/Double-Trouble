import { config } from './config.js';

// Structured JSON logs. Any field whose name looks sensitive is redacted before printing.
const SENSITIVE = /key|secret|token|authorization|password/i;
const clean = (o) => {
  if (!o || typeof o !== 'object') return o;
  const out = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : clean(v);
  return out;
};

export const serializeError = (err) => err && ({
  name: err.name, code: err.code, message: err.message,
  ...(config.env !== 'production' && err.status >= 500 ? { stack: err.stack } : {}),
});

function write(level, fields) {
  if (config.logLevel === 'silent') return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, ...clean(fields) });
  (level === 'error' ? console.error : console.log)(line);
}
export const logger = {
  info: (f) => write('info', f),
  warn: (f) => write('warn', f),
  error: (f) => write('error', f),
};
