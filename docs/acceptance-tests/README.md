# FlexiMOS acceptance testing and training pack

These scripts serve two purposes at once:

1. **Acceptance testing** — each numbered test has steps and an expected
   result. The tester marks Pass / Fail and writes observations.
2. **Training** — working through a script in order is a guided tour of that
   role's workspace. New staff can use the same document as their intro guide.

## Scripts by role

| Script | Role | Surface |
|---|---|---|
| [operator.md](operator.md) | Operator (driver/rider) | Operator PWA |
| [supervisor.md](supervisor.md) | Supervisor / amoeba owner | Supervisor console |
| [manager.md](manager.md) | Manager / GM | Manager console |
| [finance.md](finance.md) | Finance / accountant | Finance console |
| [admin.md](admin.md) | System admin / data operations | Ops admin + Identity admin consoles |
| [executive-analytics.md](executive-analytics.md) | Founder / GM / Finance lead | Analytics console |

## Before a testing session

1. Deploy the suite (see `deploy/linode/README.md`) or run it locally.
2. Seed demo data once: `node scripts/seed-ops-demo.mjs` (idempotent).
3. Confirm all three health endpoints respond and the developer portal loads.
4. Give each tester:
   - the URL of their console (listed at the top of each script) — on a
     deployed server, include the access token the first time:
     `…/apps/<console>/?token=<server token>` (it is remembered by the
     browser afterwards; not needed for the Operator PWA),
   - a printed or shared copy of their script,
   - somewhere to record results (the scripts have a results table at the end).

The demo environment uses a shared development access model, so consoles open
without a personal login; the Operator PWA is the exception and uses phone +
PIN (`000000` for seeded users). Where a script says "as supervisor Tunde",
that scoping is applied automatically by the console.

## During the session

- Ask testers to follow the steps exactly the first time, then explore freely.
- Anything confusing, slow, mislabelled or missing goes in the notes column —
  wording feedback is as valuable as bug reports at this stage.
- If a step fails, note what actually happened and continue with the next test
  unless the failure blocks it.

## After the session

Collect the results tables. Failures and repeated confusion points feed the
next build round; passed scripts sign off the role's surface for this phase.
