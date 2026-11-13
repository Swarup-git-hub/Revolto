import Settings from "../models/Settings.js";

export async function getSettings() {
  const doc = await Settings.findOneAndUpdate({ key: "default" }, { $setOnInsert: { key: "default" } }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();
  return doc;
}

/** Effective booking policy for a section: section overrides are always bounded by the college policy. */
export function effectiveBookingPolicy(settings, section) {
  const college = settings.booking;
  const s = section?.booking || {};
  const collegeCutoff = college.cutoffHoursBeforeSlot ?? 0;
  return {
    enabled: Boolean(college.enabled) && s.enabled !== false,
    collegeEnabled: Boolean(college.enabled),
    sectionEnabled: s.enabled ?? null,
    requestBy: s.requestBy || college.requestBy,
    minDurationMinutes: college.minDurationMinutes,
    maxDurationMinutes: college.maxDurationMinutes,
    cutoffHoursBeforeSlot: Math.max(collegeCutoff, s.cutoffHoursBeforeSlot ?? 0),
    allowGuideSlotCreation: college.allowGuideSlotCreation,
  };
}
