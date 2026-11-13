import { Router } from "express";
import { asyncHandler } from "../../shared/errors.js";
import { protect } from "../../shared/auth.js";
import { Validator } from "../../shared/validate.js";
import * as svc from "./auth.service.js";

const router = Router();

router.post("/send-otp", asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const email = v.email("email", { required: true });
  v.done();
  res.json(await svc.requestOtp(email));
}));

router.post("/verify-otp", asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const email = v.email("email", { required: true });
  const otp = v.string("otp", { required: true, min: 6, max: 6 });
  v.done();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit code" });
  res.json(await svc.verifyOtp(email, otp));
}));

router.get("/me", protect, asyncHandler(async (req, res) => res.json({ user: await svc.profile(req.user.id) })));

router.post("/logout", protect, asyncHandler(async (req, res) => {
  await svc.logout(req.user.id);
  res.json({ message: "Signed out" });
}));

export default router;
