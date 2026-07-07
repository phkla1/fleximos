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
2. Enter your phone number and PIN, tap **Sign in**.

**Expected:** you land on "My workday" with your name at the top. A wrong PIN
shows a clear error and does not sign you in.

### OP-2 · Read today's picture
1. Look at the dark panel at the top.

**Expected:** it shows your live status (e.g. "online", "checked out"),
today's revenue figure, and a pace label (Ahead / On track / Behind / At risk)
with the amount expected by now.

### OP-3 · Trips, hours, target
1. Check the three tiles below the dark panel.

**Expected:** trips today, hours online, and your daily target. They match
what you know about your day (for seeded data, they match the demo records).

### OP-4 · Vehicle and platform assignment
1. Scroll to **Vehicle and platform**.

**Expected:** your vehicle plate (or "No vehicle assigned") and each platform
account you are registered on, with its status.

### OP-5 · See and explain an alert
1. Scroll to **My alerts**.
2. If an alert is listed, tap **Explain what happened**.
3. Choose a reason (e.g. "Network / app issue"), add a short note, tap
   **Send to supervisor**.

**Expected:** the app confirms the explanation was sent and the alert now
shows "Reason sent: … (pending)". Your supervisor sees the same reason in
their inbox. Choosing "Other" without a note is rejected with a clear message.

### OP-6 · Check the leaderboard
1. Scroll to **Leaderboard**.

**Expected:** the top of your amoeba's board for the last 7 days, with gold /
silver / bronze badges for the top three and your own rank chip at the top
right. Your row is highlighted. You see your acceptance, online and cash
scores — but no revenue score (that is by design).

### OP-7 · Report a vehicle problem
1. Scroll to **Report maintenance**.
2. Pick a category (e.g. Brakes), describe the issue, tap **Send to supervisor**.

**Expected:** a confirmation message. The report appears in your supervisor's
maintenance queue.

### OP-8 · Get support in the field
1. Tap the red **🆘 Get support** button.
2. Pick **Breakdown** (add a note if you like).

**Expected:** confirmation that your supervisor has been notified. If your
phone asks for location permission, granting it attaches your GPS position.
Accident and police reports also escalate to the manager if not acknowledged
within 30 minutes.

### OP-9 · Look at an earlier day
1. Change the **Operating date** at the top to yesterday (the demo seed covers the last three days).

**Expected:** revenue, trips and hours update to that day.

### OP-10 · Sign out and back in
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
| OP-10 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
