export const ROLES = Object.freeze({ STUDENT: "student", GUIDE: "guide", COORDINATOR: "coordinator", HOD: "hod" });
export const ROLE_LIST = Object.values(ROLES);

export const REVIEW_TYPES = ["title", "progress", "improvements", "report"];

export const SUBMISSION_STATUS = Object.freeze({
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  CHANGES_REQUIRED: "changes_required",
  APPROVED: "approved",
  SUPERSEDED: "superseded",
});

export const CONTRIBUTION_STATUS = Object.freeze({
  PENDING: "pending_review",
  ACKNOWLEDGED: "acknowledged",
  CHANGES_REQUIRED: "changes_required",
  SUPERSEDED: "superseded",
});

export const TITLE_STATUS = ["not_submitted", "submitted", "confirmed", "changes_required"];
export const PROGRESS_STATUS = ["not_started", "in_progress", "completed"];

export const BOOKING_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});
export const SLOT_STATUS = Object.freeze({ AVAILABLE: "available", PENDING: "pending", BOOKED: "booked", DISABLED: "disabled" });

/** Extensions an administrator may allow for uploads, with the file signature we verify. */
export const FILE_SIGNATURES = {
  pdf: [Buffer.from("%PDF-")],
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  pptx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  xlsx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  zip: [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  jpeg: [Buffer.from([0xff, 0xd8, 0xff])],
};
export const MIME_BY_EXT = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const HARD_UPLOAD_LIMIT_MB = 25;
