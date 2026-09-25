# FlexiMOS — Phase 4 Spec (admin consoles usability redesign)

**Status:** BUILT (2026-09-25). Shared `admin-kit.{css,js}` (left-sidebar shell,
hash-routed view switching, grouped nav, nav search, config history-collapse,
row-menu, toast) adopted by both consoles; hr-admin and ops-admin migrated onto
it; ops-admin's Controls split into an isolated view with history folded away, a
new Cohorts monitoring view added, cross-console links wired. Covered by the
existing API + Playwright suites (updated for view switching).
**Scope:** the two admin dashboards — `ops-admin-console` (Administrator /
ops-api config + monitoring) and `hr-admin-console` (Identity & Organisation /
foundation). Reviewed live against seeded data + code on 2026-09-25.
**Not in scope:** the supervisor app (`ops-console`, already redesigned) and the
operator PWA.

## 0. Method
Both consoles were run locally against the seeded e2e data and walked
section-by-section, then cross-checked against the source. Lens: Nielsen usability
heuristics + **effectiveness** (does it support the admin's real jobs?) +
**efficiency** (steps, friction, density, scrolling, defaults).

## 1. What already works (keep)
- **Shared emerald token system.** Both consoles already define the *same*
  `:root` palette, radius, shadow, Inter + tabular-nums. Phase 4 is **not a
  recolour** — the visual DNA is already there. It is an IA/layout/consistency and
  workflow-efficiency job.
- **hr-admin tables** — clean entity tables with per-section search + status
  filter and inline edit. Good bones.
- **ops-admin Overview** — strong KPI strip + team-summary cards with pace bars.
- **Effective-dated versioning** across policies; collapsed `<details>` forms.
- Both pass the mobile no-overflow e2e — responsiveness exists.

## 2. Cross-console findings (the structural ones)
- **F1 — Two different shells for one operator.** ops-admin uses a **top tab bar**
  (12 items — Overview…System settings…Users↗ — crowds/wraps under ~1200px);
  hr-admin uses a **left sidebar rail**. The same admin switches between two
  mental models and two visual frames. *Unify on one shell.*
- **F2 — Everything is one long scrolling page; nav = anchors.** Both consoles
  stack every section on a single page and the nav just jumps to an anchor —
  which frequently lands on a section heading with a screen of whitespace (e.g.
  `#controls` opens on near-blank). No section isolation → heavy scrolling, lost
  place, slow to reach a control. *Switch to one-view-at-a-time (retain deep-link
  hashes), like the supervisor app's tab panels.*
- **F3 — Config-convention drift.** ops-admin honours `?opsApiBase` /
  `?foundationApiBase`; hr-admin only honours `?apiBase` and hard-defaults
  foundation to `:4010` (it ignored the ops-admin-style param entirely in test).
  Symptomatic of two apps drifting. *Share one env/base resolver + one
  header/status/connection component.*
- **F4 — Version history clutters live config.** The efficiency-policy list showed
  **5 versions (4 superseded)** inline; ramp profiles and pace profiles the same.
  The *active* value is buried under history. *Show the active version as one
  clear card; collapse history behind a disclosure / "+N earlier versions".*
- **F5 — Mega-sections hurt findability.** ops-admin "Controls" bundles trackers,
  pace profiles, efficiency, fleet, economics, delivery customers, allocated
  prices and leaderboard into one long scroll of unrelated policies. *Group
  config into named sub-areas with their own nav entries.*

## 3. ops-admin-console specifics
- Team-summary numbers wrap mid-figure (`₦227,183.76` breaking across lines); the
  car/bike revenue sub-labels are cryptic. *Fix card column sizing + label as
  "car rev / bike rev".*
- Pace profile renders as a dense checkpoint string
  (`12:00 40% · 16:00 65% · …`). *Show as labelled chips or a tiny sparkline.*
- Onboarding (Phase 3) lists **every** ramp version, including same-effective-date
  duplicates (the resolver picks one arbitrarily among equal dates). *Dedup /
  supersede same-date versions; show one active ramp card.*
- The **completion-bonus** params live only inside the ramp form. Phase 3 promised
  them "an obvious home" here — give Onboarding a dedicated bonus block.
- "Manual entry" (an exceptional workflow) sits between monitoring tabs — regroup.

## 4. hr-admin-console specifics
- Table IA is good — keep it as the pattern the whole redesign borrows.
- Row actions (Edit / Deactivate / ID) stack vertically into a wide actions
  column. *Collapse into a compact row actions menu or inline icons.*
- Rows show `display_name` then `legal_name` even when identical (seed artifact,
  but the UI should suppress the second line when equal).
- The note "day-to-day rider/driver assignment lives in the Administrator (Ops)
  console under Roster" is helpful but not a link. *Make cross-console references
  real links.*
- KPI chips mirror section headers — fine; let them scroll-to their section.

## 5. Proposed redesign — a shared admin design kit
A small shared front-end kit (`apps/admin-kit/` or `apps/role-console-assets/`)
that both consoles adopt, so they stop drifting:
- **One app shell** — left sidebar rail (scales past a 12-item top bar, keeps
  context visible), shared header with connection status + refresh, grouped nav:
  - **Monitor:** Overview, Team, Alerts, Reports, Data health
  - **Manage:** Roster, Vehicles (ops) · People, Users, Access, Amoebas, Sites (hr)
  - **Configure:** Targets & pace, Efficiency, Economics, Delivery pricing,
    Onboarding, Leaderboard, Fleet policy (ops)
  - **System:** Service accounts, Settings
  Each console renders only its relevant groups; a header control cross-links to
  the other console.
- **View switching** (one section visible at a time), deep-linkable by hash.
- **Config card pattern** — active version card + inline "New version" + a
  collapsed history disclosure. Ends the inline-history spam (F4).
- **Shared components** — header/status, KPI strip, entity table
  (search + filter + row-actions menu), policy/active-value card, form
  disclosure/drawer, toast notices. hr-admin's table + ops-admin's KPI/policy
  cards, standardised.
- Keep the emerald tokens; consolidate into one `admin-kit.css`.

## 6. Suggested phasing (this is two full consoles)
- **4A — Build the shared kit and migrate hr-admin onto it.** Smaller, table-based
  console → fast win, proves the shell + components + config pattern.
- **4B — Migrate ops-admin** onto the shell: view-switching, config regrouping,
  history-collapse, Overview polish.
- **4C — Polish:** pace sparkline, number formatting, Onboarding bonus home,
  cross-console links, row-action menus.
Each phase ships with its own API/e2e coverage and keeps the consoles working
throughout (no big-bang rewrite).

## 7. Decisions (resolved 2026-09-25)
- **D1 — Shell:** **left sidebar rail for both.**
- **D2 — Structure:** **two apps sharing a kit** (hr→foundation, ops→ops-api stay
  separate deploys/auth; they share the shell + components).
- **D3 — Scope:** **redesign + a few adds** — the cohort-monitoring board (Phase 3
  built `/ops/v1/onboarding/cohort-board`, no UI yet), a config search, and real
  cross-console links.
- **D4 — Phasing:** **all of 4A–4C now** (kit + both consoles + adds + polish),
  keeping the consoles working and tested throughout.

## 8. Build plan (approved)
1. **Shared kit** (`apps/role-console-assets/admin-kit.{css,js}`): left-sidebar
   shell, hash-routed view switching, connection/status header, KPI strip, entity
   table (search + filter + row-actions menu), config "active card + collapsed
   history" pattern, toasts. One env/base resolver.
2. **hr-admin** onto the kit: view switching, row-action menu, suppress duplicate
   name line, cross-link to ops-admin Roster.
3. **ops-admin** onto the kit: sidebar + view switching, regroup Controls into
   named Configure views, collapse policy history, Overview polish (number
   wrapping, pace chips), Onboarding bonus block + cohort-monitoring board view.
4. **Adds:** cohort board, config search, cross-console links.
5. Update API/e2e coverage; keep both consoles green.
