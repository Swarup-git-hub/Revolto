import { Router } from "express";
import AuditLog from "../../models/AuditLog.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler } from "../../shared/errors.js";
import { pageParams } from "../../shared/validate.js";

const router = Router();
router.use(protect, authorize("hod"));

router.get("/", asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = {};
  if (req.query.entity) filter.entity = String(req.query.entity).slice(0, 40);
  if (req.query.action) filter.action = String(req.query.action).toUpperCase().slice(0, 20);
  const [logs, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  res.json({
    total, page, limit,
    logs: logs.map((l) => ({ id: String(l._id), at: l.createdAt, actor: l.actorName, role: l.actorRole, action: l.action, entity: l.entity, entityName: l.entityName, before: l.before, after: l.after, reason: l.reason })),
  });
}));

export default router;
