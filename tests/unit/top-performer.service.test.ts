import assert from "node:assert/strict";
import { test } from "node:test";
import { TopPerformerService } from "../../apps/ops-api/src/top-performer.service.js";

// In-memory stand-ins for the three dependencies settleAwards touches.
function fakeDeps(opts: {
  settings?: { enabled?: boolean; amount_ngn?: number; threshold_ngn?: number } | null;
  board: any[];
  operators?: any[];
}) {
  const awards = new Map<string, any>(); // `${date}|${amoeba}` -> row
  const deletes: Array<{ date: string; amoeba: string }> = [];
  const settings = opts.settings === null ? null : {
    enabled: opts.settings?.enabled ?? true,
    amount_ngn: opts.settings?.amount_ngn ?? 2000,
    threshold_ngn: opts.settings?.threshold_ngn ?? 28000,
    updated_at: null,
    updated_by_person_id: null
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM ops_top_performer_bonus_settings")) return settings;
      return null;
    },
    async many(sql: string) {
      if (sql.includes("FROM ops_operators")) return opts.operators || [];
      return [];
    },
    async exec(sql: string, params: unknown[]) {
      if (sql.startsWith("DELETE FROM ops_top_performer_awards")) {
        deletes.push({ date: String(params[0]), amoeba: String(params[1]) });
        awards.delete(`${params[0]}|${params[1]}`);
        return;
      }
      if (sql.includes("INSERT INTO ops_top_performer_awards")) {
        const [, date, amoeba, operator_id, person_id, supervisor, net, amount, threshold] = params as any[];
        awards.set(`${date}|${amoeba}`, { operator_id, person_id, supervisor, net, amount, threshold });
        return;
      }
    }
  };
  const ops = {
    dateRange: ({ record_date }: { record_date?: string }) => ({ from: record_date, to: record_date })
  };
  const pacing = { async pacingBoard() { return opts.board; } };
  const service = new TopPerformerService(db as any, ops as any, pacing as any);
  return { service, awards, deletes };
}

function row(over: Partial<any>) {
  return { amoeba_id: "amb_1", operator_id: "op_x", person_id: "p_x", combined_earned_ngn: 0, scheduled_delivered: 0, ...over };
}

test("awards ₦2k to the single highest net-revenue earner above the floor", async () => {
  const { service, awards } = fakeDeps({
    board: [
      row({ operator_id: "op_a", person_id: "p_a", combined_earned_ngn: 31000 }),
      row({ operator_id: "op_b", person_id: "p_b", combined_earned_ngn: 29000 }),
      row({ operator_id: "op_c", person_id: "p_c", combined_earned_ngn: 40000, amoeba_id: "amb_2" })
    ],
    operators: [
      { operator_id: "op_a", activated_at: "2026-01-01", supervisor_person_id: "sup_1" },
      { operator_id: "op_b", activated_at: "2026-01-02", supervisor_person_id: "sup_1" },
      { operator_id: "op_c", activated_at: "2026-01-01", supervisor_person_id: "sup_2" }
    ]
  });
  const result = await service.settleAwards("2026-11-07");
  assert.equal(result.upserted, 2);
  assert.equal(awards.get("2026-11-07|amb_1").operator_id, "op_a");
  assert.equal(Number(awards.get("2026-11-07|amb_1").amount), 2000);
  assert.equal(Number(awards.get("2026-11-07|amb_1").net), 31000);
  assert.equal(awards.get("2026-11-07|amb_2").operator_id, "op_c");
});

test("no award when the amoeba's best does not clear the floor; a stale award is cleared", async () => {
  const { service, awards, deletes } = fakeDeps({
    settings: { threshold_ngn: 28000 },
    board: [
      row({ operator_id: "op_a", combined_earned_ngn: 28000 }), // exactly at floor — not above
      row({ operator_id: "op_b", combined_earned_ngn: 20000 })
    ]
  });
  const result = await service.settleAwards("2026-11-07");
  assert.equal(result.upserted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(awards.size, 0);
  assert.deepEqual(deletes[0], { date: "2026-11-07", amoeba: "amb_1" });
});

test("ties break by parcels delivered, then earliest-registered", async () => {
  const byParcels = fakeDeps({
    board: [
      row({ operator_id: "op_a", combined_earned_ngn: 30000, scheduled_delivered: 3 }),
      row({ operator_id: "op_b", combined_earned_ngn: 30000, scheduled_delivered: 8 })
    ],
    operators: [
      { operator_id: "op_a", activated_at: "2026-01-01", supervisor_person_id: "sup_1" },
      { operator_id: "op_b", activated_at: "2026-02-01", supervisor_person_id: "sup_1" }
    ]
  });
  await byParcels.service.settleAwards("2026-11-07");
  assert.equal(byParcels.awards.get("2026-11-07|amb_1").operator_id, "op_b", "more parcels wins");

  const byTenure = fakeDeps({
    board: [
      row({ operator_id: "op_a", combined_earned_ngn: 30000, scheduled_delivered: 5 }),
      row({ operator_id: "op_b", combined_earned_ngn: 30000, scheduled_delivered: 5 })
    ],
    operators: [
      { operator_id: "op_a", activated_at: "2026-03-01", supervisor_person_id: "sup_1" },
      { operator_id: "op_b", activated_at: "2026-01-01", supervisor_person_id: "sup_1" }
    ]
  });
  await byTenure.service.settleAwards("2026-11-07");
  assert.equal(byTenure.awards.get("2026-11-07|amb_1").operator_id, "op_b", "earliest-registered wins when parcels tie");
});

test("the configured amount and floor are applied", async () => {
  const { service, awards } = fakeDeps({
    settings: { amount_ngn: 5000, threshold_ngn: 35000 },
    board: [
      row({ operator_id: "op_a", combined_earned_ngn: 34000 }), // below the raised floor
      row({ operator_id: "op_b", combined_earned_ngn: 36000 })
    ],
    operators: [
      { operator_id: "op_a", activated_at: "2026-01-01", supervisor_person_id: "sup_1" },
      { operator_id: "op_b", activated_at: "2026-01-01", supervisor_person_id: "sup_1" }
    ]
  });
  await service.settleAwards("2026-11-07");
  const award = awards.get("2026-11-07|amb_1");
  assert.equal(award.operator_id, "op_b");
  assert.equal(Number(award.amount), 5000);
  assert.equal(Number(award.threshold), 35000);
});

test("a disabled programme settles nothing", async () => {
  const { service, awards, deletes } = fakeDeps({
    settings: { enabled: false },
    board: [row({ operator_id: "op_a", combined_earned_ngn: 50000 })]
  });
  const result = await service.settleAwards("2026-11-07");
  assert.deepEqual(result, { received: 0, upserted: 0, rejected: 0 });
  assert.equal(awards.size, 0);
  assert.equal(deletes.length, 0);
});
