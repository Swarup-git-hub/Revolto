"""
Browser smoke test (Python + Playwright). Drives the real UI against a real backend.
Prereqs: backend running with DEV_FIXED_OTP=123456 on a throw-away database seeded by `npm run seed:demo`,
and the frontend served on BASE (e.g. `npm run build && npm run preview`).
Usage: BASE=http://localhost:4173 SHOTS=./shots python3 e2e/smoke.py
"""
import os, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:4173")
SHOTS = os.environ.get("SHOTS", "./shots")
OTP = os.environ.get("OTP", "123456")
os.makedirs(SHOTS, exist_ok=True)
problems, passed = [], []

def check(name, fn):
    try:
        fn(); passed.append(name); print("PASS", name)
    except Exception as e:  # noqa: BLE001
        problems.append((name, str(e)[:400])); print("FAIL", name, "->", str(e)[:300])

def login(page, email):
    page.goto(f"{BASE}/login")
    page.get_by_label("College email address").fill(email)
    page.get_by_role("button", name="Send sign-in code").click()
    page.get_by_label("6-digit code").fill(OTP)
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("heading", name="Welcome", exact=False)).to_be_visible(timeout=8000)

def logout(page):
    page.get_by_role("button", name="Sign out").first.click()
    expect(page.get_by_label("College email address")).to_be_visible()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    console_errors, bad_responses = [], []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: bad_responses.append(f"{r.status} {r.url}") if r.status >= 500 else None)

    page.goto(f"{BASE}/login"); page.screenshot(path=f"{SHOTS}/01-login.png")

    def bad_code():
        page.get_by_label("College email address").fill("student1@example.edu")
        page.get_by_role("button", name="Send sign-in code").click()
        page.get_by_label("6-digit code").fill("000000")
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_role("alert")).to_contain_text("incorrect or has expired")
    check("login: wrong code shows an error", bad_code)

    def student_flow():
        login(page, "student1@example.edu")
        page.screenshot(path=f"{SHOTS}/02-student-dashboard.png", full_page=True)
        page.get_by_role("link", name="My project").first.click()
        page.get_by_role("tab", name="Review 1").click()
        page.get_by_role("button", name="Start submission").click()
        page.get_by_label("Project title").fill("Smart Attendance System")
        page.get_by_label("Problem statement").fill("Manual attendance wastes class time.")
        page.get_by_label("Objectives").fill("Automate attendance with face recognition.")
        page.get_by_label("Initial requirements status").select_option("in_progress")
        page.get_by_role("button", name="Submit", exact=True).click()
        expect(page.get_by_text("Version 1").first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/03-student-review1.png", full_page=True)
    check("student (leader) submits Review 1 through the UI", student_flow)

    def student_validation():
        page.get_by_role("tab", name="Review 2").click()
        page.get_by_role("button", name="Start submission").click()
        page.get_by_role("button", name="Submit", exact=True).click()
        expect(page.get_by_text("Progress summary is required")).to_be_visible(timeout=5000)
    check("form validation errors appear next to fields", student_validation)

    def student_progress():
        page.get_by_label("Progress summary").fill("Requirements finished, UI started.")
        # complete the first milestone, leave the rest as not started
        page.get_by_label("Requirements status").select_option("completed")
        page.get_by_role("button", name="Submit", exact=True).click()
        expect(page.get_by_text("Version 1").first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/04-student-review2.png", full_page=True)
    check("student submits Review 2 progress with milestone checklist", student_progress)

    def student_contribution():
        page.get_by_role("button", name="Record my contribution").click()
        page.get_by_label("What did you work on?").fill("Wrote the login screen.")
        page.get_by_role("button", name="Save contribution").click()
        expect(page.get_by_text("Pending review").first).to_be_visible(timeout=6000)
    check("leader records an individual contribution (shown as pending review)", student_contribution)

    def student_bookings_page():
        page.get_by_role("link", name="Review slots").click()
        expect(page.get_by_role("heading", name="Review slots")).to_be_visible()
        page.screenshot(path=f"{SHOTS}/05-student-bookings.png", full_page=True)
    check("student bookings page loads", student_bookings_page)
    logout(page)

    def guide_flow():
        login(page, "guide1@example.edu")
        page.screenshot(path=f"{SHOTS}/06-guide-dashboard.png", full_page=True)
        page.get_by_role("link", name="Review queue").first.click()
        expect(page.get_by_text("A-T01").first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/07-guide-queue.png", full_page=True)
        page.get_by_text("review 1").first.click()
        page.get_by_role("button", name="Record decision").click()
        page.get_by_label("Request changes").check()
        page.get_by_role("button", name="Save decision").click()
        expect(page.get_by_text("Feedback is required", exact=False)).to_be_visible(timeout=5000)
        page.get_by_label("Feedback (required)").fill("Narrow the scope to one domain.")
        page.get_by_role("button", name="Save decision").click()
        expect(page.get_by_text("Changes required").first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/08-guide-decision.png", full_page=True)
    check("guide: queue -> request changes needs feedback -> decision saved", guide_flow)

    def guide_title_edit():
        page.get_by_role("tab", name="Overview").click()
        page.get_by_role("button", name="Edit title").click()
        page.get_by_label("New title").fill("Face-based Attendance System")
        page.get_by_role("button", name="Save change").click()
        expect(page.get_by_text("Reason is required", exact=False)).to_be_visible(timeout=5000)
        page.get_by_label("Reason for the change").fill("Clarified scope with the team")
        page.get_by_role("button", name="Save change").click()
        expect(page.get_by_text("Clarified scope with the team")).to_be_visible(timeout=6000)
    check("guide edits title; reason mandatory; history shows old/new/reason", guide_title_edit)

    def guide_slots():
        page.get_by_role("link", name="Slots & bookings").first.click()
        page.get_by_role("tab", name="Slots").click()
        page.get_by_label("From date").fill("2030-03-04"); page.get_by_label("To date").fill("2030-03-06")
        page.get_by_role("button", name="Preview slots").click()
        expect(page.get_by_text("will be created", exact=False).first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/09-slot-preview.png", full_page=True)
        page.get_by_role("button", name="Create", exact=False).first.click()
        expect(page.get_by_text("slot(s) created")).to_be_visible(timeout=6000)
    check("guide previews and creates date-range slots", guide_slots)
    logout(page)

    def hod_flow():
        login(page, "hod@example.edu")
        page.screenshot(path=f"{SHOTS}/10-hod-dashboard.png", full_page=True)
        for link, heading in [("Teams", "Teams"), ("People", "People"), ("Sections", "Sections"), ("Review setup", "Review setup"), ("Imports", "Bulk import"), ("Reports", "Reports & exports"), ("Settings", "Settings"), ("Audit log", "Audit log")]:
            page.get_by_role("link", name=link, exact=True).first.click()
            expect(page.get_by_role("heading", name=heading, exact=True).first).to_be_visible(timeout=6000)
        page.get_by_role("link", name="Audit log", exact=True).first.click()
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{SHOTS}/11-hod-audit.png", full_page=True)
        expect(page.locator("summary strong", has_text="BookingSlot").first).to_be_visible(timeout=6000)
    check("HOD: every admin page renders", hod_flow)

    def hod_policy_toggle():
        page.get_by_role("link", name="Slots & bookings").first.click()
        page.get_by_role("tab", name="Policy").click()
        page.get_by_label("Slot booking enabled college-wide").uncheck()
        page.get_by_role("button", name="Save policy").click()
        expect(page.get_by_text("Booking policy saved")).to_be_visible(timeout=6000)
        expect(page.get_by_text("currently switched off").first).to_be_visible(timeout=6000)
        page.screenshot(path=f"{SHOTS}/12-hod-policy-off.png", full_page=True)
    check("HOD disables booking college-wide; banner shows", hod_policy_toggle)
    logout(page)

    def pagination_flows():
        login(page, "hod@example.edu")
        # --- People: 60 bulk students + demo accounts → several pages of 25
        page.get_by_role("link", name="People", exact=True).first.click()
        expect(page.get_by_text("Showing 1–25 of", exact=False)).to_be_visible(timeout=6000)
        total = int(page.get_by_text("Showing 1–25 of", exact=False).inner_text().split(" of ")[1].split()[0])
        assert total > 60, f"expected >60 accounts, saw {total}"
        page.get_by_role("button", name="Next").click()
        expect(page.get_by_text("Showing 26–50 of", exact=False)).to_be_visible(timeout=6000)
        expect(page.get_by_text("Page 2 of", exact=False)).to_be_visible()
        # filtering resets to page 1 and the total follows the filter, not the page size
        page.get_by_placeholder("Search name, email or roll no.").fill("Bulk Student")
        expect(page.get_by_text("Showing 1–25 of 60 accounts")).to_be_visible(timeout=6000)
        page.get_by_role("button", name="Next").click()
        expect(page.get_by_text("Showing 26–50 of 60 accounts")).to_be_visible(timeout=6000)
        page.get_by_role("button", name="Next").click()
        expect(page.get_by_text("Showing 51–60 of 60 accounts")).to_be_visible(timeout=6000)
        expect(page.get_by_role("button", name="Next")).to_be_disabled()
        page.wait_for_timeout(400)
        n_rows = page.locator("tbody tr").count()
        assert n_rows == 10, f"last page shows the remaining 10 rows, saw {n_rows}"
        page.screenshot(path=f"{SHOTS}/17-people-pagination.png", full_page=True)
        # --- Teams: 40 bulk + 4 demo
        page.get_by_role("link", name="Teams", exact=True).first.click()
        expect(page.get_by_text("Showing 1–25 of 4", exact=False)).to_be_visible(timeout=6000)
        page.get_by_role("button", name="Next").click()
        expect(page.get_by_text("Showing 26–4", exact=False)).to_be_visible(timeout=6000)
        page.get_by_placeholder("Search team ID or title").fill("PG-T")
        expect(page.get_by_text("Showing 1–25 of 40 teams")).to_be_visible(timeout=6000)
    check("pagination: People and Teams page on the server, filters and search preserved/reset correctly", pagination_flows)
    logout(page)

    def student_sees_disabled():
        login(page, "student1@example.edu")
        page.get_by_role("link", name="Review slots").click()
        expect(page.get_by_text("currently switched off").first).to_be_visible(timeout=6000)
        page.get_by_role("link", name="My project").first.click()
        page.get_by_role("tab", name="Review 3").click()
        expect(page.get_by_role("button", name="Start submission")).to_be_visible()
    check("booking disabled: student still reaches progress/reviews", student_sees_disabled)
    logout(page)

    def leader_removal():
        login(page, "guide1@example.edu")
        page.get_by_role("link", name="My teams", exact=True).first.click()
        page.get_by_text("B-T01").first.click()
        page.get_by_role("button", name="Remove Student 5").click()
        confirm = page.get_by_role("dialog").get_by_role("button", name="Remove", exact=True)
        expect(confirm).to_be_disabled()  # cannot remove the leader without choosing a replacement
        expect(page.get_by_role("dialog").get_by_text("current team leader", exact=False)).to_be_visible()
        page.get_by_label("New team leader").select_option(label="Student 6 (22CS006)")
        page.wait_for_timeout(600)
        bg = confirm.evaluate("e => getComputedStyle(e).backgroundImage + getComputedStyle(e).backgroundColor")
        assert "rgb(178, 90, 81)" in bg or "178, 90, 81" in bg, f"destructive button is not styled (background: {bg})"
        page.screenshot(path=f"{SHOTS}/15-leader-removal-dialog.png")
        confirm.click()
        expect(page.get_by_text("Member removed.")).to_be_visible(timeout=6000)
        expect(page.get_by_text("Student 6", exact=False).first).to_be_visible()
        expect(page.get_by_text("Leader", exact=True)).to_have_count(1)
        expect(page.get_by_text("Student 5", exact=False)).to_have_count(0)
        page.screenshot(path=f"{SHOTS}/16-leader-removed.png", full_page=True)
    check("guide removes the team leader: replacement required, then leader switches", leader_removal)
    logout(page)

    def mobile():
        m = browser.new_context(viewport={"width": 390, "height": 800}); mp = m.new_page()
        login(mp, "student1@example.edu")
        mp.screenshot(path=f"{SHOTS}/13-mobile-dashboard.png", full_page=True)
        mp.get_by_role("button", name="Open menu").click()
        expect(mp.get_by_role("link", name="My project", exact=True)).to_be_visible()
        mp.screenshot(path=f"{SHOTS}/14-mobile-menu.png")
        sw = mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        assert sw, "page scrolls horizontally on a phone viewport"
        m.close()
    check("mobile layout (390px): menu works, no horizontal overflow", mobile)

    browser.close()

print(f"\n{len(passed)} passed, {len(problems)} failed")
real_console = [c for c in console_errors if "401" not in c and "400" not in c and "409" not in c and "403" not in c]
print("console errors (excluding expected 4xx):", real_console[:5] or "none")
print("5xx responses:", bad_responses or "none")
for n, m in problems: print("  -", n, "|", m)
sys.exit(1 if problems or bad_responses else 0)
