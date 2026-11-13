import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { asyncHandler, forbidden, unauthorized } from "./errors.js";

export const signToken = (user) => jwt.sign({ id: String(user._id), tv: user.tokenVersion || 0 }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

/** Validates a bearer token and returns the live user (so deactivation / logout take effect immediately). */
export async function authenticateToken(token) {
  if (!token) throw unauthorized();
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized("Your session has expired. Please sign in again.");
  }
  const user = await User.findById(decoded.id).lean();
  if (!user || !user.isActive || (user.tokenVersion || 0) !== decoded.tv) throw unauthorized("Your session is no longer valid. Please sign in again.");
  return {
    id: String(user._id),
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    team: user.team ? String(user.team) : null,
    section: user.section ? String(user.section) : null,
    sections: (user.sections || []).map(String),
  };
}

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  req.user = await authenticateToken(header.startsWith("Bearer ") ? header.slice(7) : null);
  next();
});

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
