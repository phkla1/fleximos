# Operator acceptance tests — Operator PWA

**Who this is for:** drivers, riders and couriers.
**Where:** `https://<host>/apps/operator-pwa/` (add it to your phone's home screen — it installs like an app).
**Login:** your registered phone number and PIN. Seeded demo users have PIN `000000`.

The Operator PWA is your personal workday view: today's earnings against
target, your alerts, your vehicle, the team leaderboard, and quick ways to get
help or report a vehicle problem.

## Tests

### OP-1 · Sign in
1. Open the app URL on your phone.
2. Enter your phone number in the everyday format (e.g. `0816 540 7221` —
   spaces and the leading 0 both work) and your PIN, tap **Sign in**.

**Expected:** you land on "My workday" with your name at the top. A wrong PIN
shows a clear error and does not sign you in.

### OP-2 · Read today's picture
1. Look at the earnings gauge on the Today tab.

**Expected:** the big ring gauge shows today's earnings with a pace label
(Ahead / On track / Behind / At risk) and the amount expected by now; the
ring is green/amber/red to match. A caption notes these are platform
earnings (Uber/Bolt) — scheduled-delivery work is tracked separately. Below
it, your live status strip shows e.g. "online" or "checked out".

### OP-3 · Trips, hours, acceptance, target
1. Check the four chips below the status strip.

**Expected:** trips, hours online, acceptance % and your daily target. They
match what you know about your day (for seeded data, the demo records). The
bottom dock has five tabs — Dispatch (with a pending-stops badge), Today,
Alerts (count badge when open), Rank, Report.

### OP-4 · Vehicle and platform assignment
1. Scroll to **Vehicle and platform**.

**Expected:** your vehicle plate (or "No vehicle assigned") and each platform
account you are registered on, with its status.

### OP-5 · See and explain an alert
1. Open the **Alerts** tab.
2. If an alert is listed, tap **Explain what happened**.
3. Choose a reason (e.g. "Network / app issue"), add a short note, tap
   **Send to supervisor**.

**Expected:** the app confirms the explanation was sent and the alert now
shows "Reason sent: … (pending)". Your supervisor sees the same reason in
their inbox. Choosing "Other" without a note is rejected with a clear message.

### OP-6 · Check the leaderboard
1. Open the **Rank** tab.

**Expected:** your rank ring (score out of 100, coloured by how well you're
doing) above the last-7-days team board with gold/silver/bronze for the top
three; your row is highlighted. You see acceptance, online and cash scores —
but no revenue score (that is by design).

### OP-7 · Report a vehicle problem with photo
1. Open the **Report** tab.
2. Pick a category (e.g. Brakes), describe the issue.
3. Tap the photo field — your camera should open **directly** (no gallery
   picker); take a picture, then **Send to supervisor**.

**Expected:** the photo shows "attached" with a timestamp before sending, a
confirmation follows, and the report (with the 📷 photo) appears in your
supervisor's maintenance queue. Photos can only come from the camera so
they are credible and time-stamped.

### OP-8 · Get support in the field
1. From ANY tab, tap the floating red **🆘** button (it is always visible,
   riding above the bottom tab bar; the Report tab also has a full-width
   version). A photo can be attached, camera-only.
2. Pick **Breakdown** (add a note if you like).

**Expected:** the support dialog opens instantly from every screen;
confirmation that your supervisor has been notified. If your
phone asks for location permission, granting it attaches your GPS position.
Accident and police reports also escalate to the manager if not acknowledged
within 30 minutes.

### OP-9 · Look at an earlier day or a range
1. Set **From** and **To** at the top to yesterday (the demo seed covers the last three days).
2. Then set **From** to two days ago, keeping **To** on today.

**Expected:** with both dates equal, figures show that single day; with a
wider range, revenue, trips and hours sum across the days and the target
scales to match.

### OP-9b · My Dispatch (couriers)
1. Sign in as a courier with delivery work (e.g. `0707 377 2773`). The app
   opens on **Dispatch**.
2. Tap **🚀 START ROUTE**. Where the batch has a stop manifest: use
   **Navigate** (opens maps), **📞 Call**, **Arrived**, then **Delivered** —
   attach a camera photo and sign on screen; for one stop use **Failed** and
   pick a reason (a reason is mandatory; "Other" needs a note).
3. On a counts-only batch, update the Delivered/Failed steppers and save.

**Expected:** completed stops update your delivered/failed counts instantly;
failed stops always carry a reason; delivered stops carry your proof (photo,
signature, GPS, time); your entries are labelled rider-entered and your
supervisor confirms them at closeout.

### OP-10 · Deliveries today (couriers)
1. Sign in as a courier with a delivery assignment (e.g. `0707 377 2773`).

**Expected:** a "Deliveries today" card on the Today tab: customer name,
delivered-of-assigned progress bar, failed count, and ₦ earned of ₦ target —
both at the allocated price. You never see the customer's contract price.

### OP-11 · Sign out and back in
1. Tap the sign-out button (top right), then sign in again.

**Expected:** clean sign-out, clean sign-in, data intact.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| OP-1 | | |
| OP-2 | | |
| OP-3 | | |
| OP-4 | | |
| OP-5 | | |
| OP-6 | | |
| OP-7 | | |
| OP-8 | | |
| OP-9 | | |
| OP-9b | | |
| OP-10 | | |
| OP-11 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
