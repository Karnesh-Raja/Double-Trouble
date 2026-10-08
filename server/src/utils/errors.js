export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
