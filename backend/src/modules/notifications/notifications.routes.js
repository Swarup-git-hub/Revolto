import { Router } from "express";
import Notification from "../../models/Notification.js";
import { protect } from "../../shared/auth.js";
import { asyncHandler, notFound } from "../../shared/errors.js";
import { parseId } from "../../shared/validate.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(async (req, res) => {
  const list = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  const unread = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
  res.json({ notifications: list.map((n) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, link: n.link, isRead: n.isRead, createdAt: n.createdAt })), unread });
}));

router.post("/read-all", asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
  res.json({ message: "All notifications marked as read" });
}));

router.post("/:id/read", asyncHandler(async (req, res) => {
  const r = await Notification.updateOne({ _id: parseId(req.params.id), recipient: req.user._id }, { $set: { isRead: true, readAt: new Date() } });
  if (!r.matchedCount) throw notFound("Notification not found");
  res.json({ message: "Marked as read" });
}));

export default router;
