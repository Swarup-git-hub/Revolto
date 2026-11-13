export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}
export const badRequest = (m, d) => new AppError(400, m, d);
export const unauthorized = (m = "Authentication required") => new AppError(401, m);
export const forbidden = (m = "You do not have permission to perform this action") => new AppError(403, m);
export const notFound = (m = "Not found") => new AppError(404, m);
export const conflict = (m, d) => new AppError(409, m, d);
export const tooMany = (m) => new AppError(429, m);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
