// Must be imported before any src/ module so configuration is read from these values.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.OTP_MAX_REQUESTS_PER_HOUR = "5";
process.env.OTP_MAX_VERIFY_ATTEMPTS = "5";
process.env.UPLOAD_DIR = "./uploads-test";
process.env.GMAIL_USER = "";
process.env.GMAIL_APP_PASSWORD = "";
