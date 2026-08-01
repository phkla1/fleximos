# Operator App — Spec v0.1 (My Cockpit)

**Status:** O1 slice built for local review; O2 backlog listed below
**Derived from:** `docs/Supervisor-App-Frontend-Brief.md` (shared visual
ethos) and `docs/Supervisor-App-Spec-v0.1.md` (the supervisor cockpit drives
this design)

The operator app is the operator's personal cockpit: one glance answers
"how am I doing right now, and what do I need to handle?". It inherits the
supervisor app's design grammar — red/yellow/green status logic, circular
gauges, dock navigation, large touch targets, 320px-safe — scaled down to a
single person's day.

## O1 screens (built)

- **Today** — speedometer-style Net Earnings gauge vs daily target (RYG by
  pace), live status strip, trips/hours/acceptance chips, vehicle + platform
  assignment card, fuel/mileage strip, and a derived timeline of the day
  (alerts fired/resolved, fuel confirms, incidents, explanations).
- **Alerts** — open alerts with the "Explain what happened" deviation flow;
  dock badge shows the open count.
- **Rank** — weekly amoeba leaderboard: my-rank hero ring, medal rows,
  score components (acceptance/online/cash — revenue never shown to
  operators, per policy).
- **Report** — 🆘 support requests (breakdown/accident/police/fuel/battery)
  and maintenance reports, both with **optional camera-only photo
  evidence**: `capture=environment` (camera opens directly, no gallery),
  capture-time stamped by the app, GPS attached when granted, uploaded
  through `/ops/v1/media` so supervisors and managers see the same
  credibility chain as inspections.

Login stays phone + PIN (Foundation dev sessions). The From/To range applies
to Today's figures; all other tabs are live "now" views.

## The two delivery modes (design constraint for every slice)

Operators work in two modes, sometimes within one day:

1. **On-demand** — Uber/Bolt ride-hailing and courier work. Platform feeds
   drive earnings, trips, hours, acceptance and the pace gauge. This is what
   O1 measures.
2. **Scheduled deliveries** — customer batch work (manifest → sort → assign
   → deliver → PoD/exceptions → returns). No platform feed; progress is
   package counts and stop completion (Supervisor spec 2.7).

O1 rule: the Today gauge is explicitly labelled as **platform earnings** so
it never silently misreads a scheduled-delivery day. O2 rule: when the
delivery APIs land, an operator assigned to a batch gets (a) an "on
delivery" work state that suspends on-demand pace judgement for that
window, (b) a delivery progress card (stops done / packages left), and
(c) delivery work reflected in the leaderboard so scheduled days are never
scoreless. Mode-mixing display (partial day each) is an O2 design decision
to take with real batch data.

## O2 backlog (needs the readiness/deliveries APIs or product decisions)

- Morning readiness self-check (photo proof items) feeding the supervisor
  exception view — model per Supervisor spec 2.5.
- Delivery work: assigned batch/stops, delivery/exception/PoD capture with
  `fleximos_scan` events (Supervisor spec 2.7 v2).
- Supervisor nudges surfacing as in-app notifications.
- Offline write queue for explain/report actions.
- Streaks and richer gamification once the leaderboard has production data.
