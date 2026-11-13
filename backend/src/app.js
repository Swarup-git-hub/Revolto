import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./shared/errors.middleware.js";
import { uploadDirWritable } from "./shared/upload.js";
import auth from "./modules/auth/auth.routes.js";
import settings from "./modules/settings/settings.routes.js";
import sections from "./modules/sections/sections.routes.js";
import users from "./modules/users/users.routes.js";
import teams from "./modules/teams/teams.routes.js";
import reviews from "./modules/reviews/reviews.routes.js";
import bookings from "./modules/bookings/bookings.routes.js";
import imports from "./modules/imports/imports.routes.js";
import reports from "./modules/reports/reports.routes.js";
import dashboard from "./modules/dashboard/dashboard.routes.js";
import notifications from "./modules/notifications/notifications.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";

/** Express app factory (no listening / DB connection here, so tests can mount it directly). */
export function createApp({ rateLimit: rl = env.rateLimit } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  // liveness / readiness probes sit before the rate limiter so orchestrators are never throttled
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/health/ready", async (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    const uploads = await uploadDirWritable();
    res.status(db && uploads ? 200 : 503).json({ status: db && uploads ? "ready" : "not_ready", db, uploads });
  });

  if (rl.enabled) {
    // Per-IP limits (in-memory per instance). Sign-in, exports and uploads get tighter limits than the general API.
    const limiter = (limit) => rateLimit({ windowMs: rl.windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests. Please wait a moment and try again." } });
    app.use("/api", limiter(rl.max));
    app.use("/api/auth", limiter(rl.authMax));
    app.use("/api/exports", limiter(rl.exportMax));
    app.post("/api/teams/:teamId/reviews/:reviewKey/submissions", limiter(rl.uploadMax));
  }
  app.use("/api/auth", auth);
  app.use("/api/settings", settings);
  app.use("/api/sections", sections);
  app.use("/api/users", users);
  app.use("/api/teams", teams);
  app.use("/api/bookings", bookings);
  app.use("/api/imports", imports);
  app.use("/api/exports", reports);
  app.use("/api/dashboard", dashboard);
  app.use("/api/notifications", notifications);
  app.use("/api/audit", auditRoutes);
  app.use("/api", reviews); // /reviews/*, /teams/:id/reviews/*, /submissions/*, /contributions/*

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
