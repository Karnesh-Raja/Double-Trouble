import { logger } from '../utils/logger.js';

// One structured log line per request: timestamp, request, shipmentId, operation, result, duration. No bodies or headers.
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      operation: 'http.request',
      request: `${req.method} ${req.originalUrl.split('?')[0]}`,
      shipmentId: res.locals.shipmentId ?? null,
      status: res.statusCode,
      result: res.statusCode < 400 ? 'ok' : 'error',
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      ...(res.locals.errorInfo ? { error: res.locals.errorInfo } : {}),
    });
  });
  next();
}
