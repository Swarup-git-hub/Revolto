import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export const notFoundHandler = (req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = "Something went wrong. Please try again.";
  let details;

  if (err instanceof AppError) {
    ({ status, message, details } = err);
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Request body is not valid JSON";
  } else if (err?.name === "ValidationError") {
    status = 400;
    message = "Validation failed";
    details = Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.message]));
  } else if (err?.name === "CastError") {
    status = 400;
    message = "Invalid identifier";
  } else if (err?.code === 11000) {
    status = 409;
    message = "That record already exists or conflicts with an existing one";
  } else if (err?.name === "MulterError") {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "The uploaded file is too large" : "Upload failed";
  }

  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(status).json({ error: message, ...(details ? { details } : {}), ...(!env.isProd && status >= 500 ? { debug: err?.message } : {}) });
}
