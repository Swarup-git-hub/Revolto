import AuditLog from "../models/AuditLog.js";

/** Records an administrative action. Never throws: auditing must not break the operation, but failures are logged. */
export async function audit(actor, { action, entity, entityId, entityName, before, after, reason, metadata, ip }) {
  try {
    await AuditLog.create({
      actor: actor._id || actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      entity,
      entityId,
      entityName,
      before,
      after,
      reason,
      ip,
      metadata,
    });
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}
