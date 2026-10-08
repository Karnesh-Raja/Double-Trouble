import { AppError } from '../utils/errors.js';
import { logger, serializeError } from '../utils/logger.js';

export const notFoundHandler = (req, res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));

// Clients get a safe message + code. Stack traces and internals are only ever written to the server log.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = 500, code = 'INTERNAL_ERROR', message = 'Internal server error', details;

  if (err instanceof AppError) ({ status, code, message, details } = err);
  else if (err?.name === 'InvalidInputError') { status = 400; code = 'VALIDATION_ERROR'; message = err.message; details = err.details; }
  else if (err?.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON'; }
  else if (err?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large'; }
  else if (typeof err?.code === 'string' && err.code.startsWith('ERR_SQLITE')) { status = 503; code = 'DATABASE_ERROR'; message = 'Database temporarily unavailable'; }

  res.locals.errorInfo = serializeError(Object.assign(err ?? new Error('unknown'), { status }));
  if (status >= 500) logger.error({ operation: 'http.error', request: `${req.method} ${req.path}`, shipmentId: res.locals.shipmentId ?? null, result: 'error', error: res.locals.errorInfo });
  res.status(status).json({ error: message, code, ...(details ? { details } : {}) });
}
