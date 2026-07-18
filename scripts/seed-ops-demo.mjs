const foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
const opsBase = process.env.OPS_API_BASE || "http://127.0.0.1:4030";
const token = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

const operators = [
  { name: "Danjimoh Osheimoh", phone: "+2347050599554", type: "rider", amoeba: "amoeba_mainland", site: "site_mainland_1", target: 27000, account: "platform_bolt_lagos", externalId: "e9a2aa9e-5c68-4f40-a562-33988126d048", plate: "MUS94QR", vehicle: "Motorbike" },
  { name: "Odeh Johnson Sunday", phone: "+2348165407221", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "FKJ176KM" },
  { name: "Bawa Oseni Umoru", phone: "+2347068757845", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "FKJ178KM" },
  { name: "Kingsley U Nwokeocha", phone: "+2349051868731", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "GGE305KL" },
  { name: "Peter Sunday Opoke", phone: "+2347068389691", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "AGL199KM" },
  { name: "Nathaniel Richard Enang", phone: "+2348081182286", amoeba: "amoeba_island", site: "site_island_1", account: "platform_uber_cars", plate: "AGL198KM" },
  { name: "Julius Tolulope Olatunji", phone: "+2348023022595", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "GGE307KL" },
  { name: "Francis Eze", phone: "+2349036453515", amoeba: "amoeba_island", site: "site_island_1", account: "platform_uber_cars", plate: "FKJ179KM" },
  { name: "Odulaja Abiodun Odufuwa", phone: "+2347049649171", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "GGE916KL" },
  { name: "Thaddeus Obeh Abah", phone: "+2349150489283", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "GGE917KL" },
  { name: "Sunday Moses Oluwole", phone: "+2348137751905", amoeba: "amoeba_island", site: "site_island_1", account: "platform_uber_cars", plate: "AGL197KM" },
  { name: "Yakub Aliu", phone: "+2347034270809", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "AKD731KJ" },
  { name: "John Chukwuemeka Ohakwe", phone: "+2349047938699", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "FKJ177KM" },
  { name: "Greg Okei Ossai", phone: "+2348166114475", amoeba: "amoeba_mainland", site: "site_mainland_2", account: "platform_uber_cars", plate: "GGE306KL" },
  { name: "Nnamdi Nwosu", phone: "+2347073772773", type: "rider", amoeba: "amoeba_island", site: "site_island_1", target: 27000, account: "platform_uber_courier", plate: null },
  { name: "Gakurnan Tapauro Moses", phone: "+2349025732144", type: "rider", amoeba: "amoeba_island", site: "site_island_1", target: 27000, account: "platform_uber_courier", plate: null },
  { name: "Godfrey Nashel", phone: "+2349012329976", type: "rider", amoeba: "amoeba_island", site: "site_island_1", target: 27000, account: "platform_uber_courier", plate: "KRD137QR", vehicle: "2024 Uber Motorbike" }
].map((item, index) => ({
  type: "driver",
  target: 60000,
  externalId: `recent-demo-${String(index + 1).padStart(2, "0")}`,
  vehicle: "2026 Bajaj Qute",
  ...item
}));

// The demo window covers SEED_WINDOW_DAYS days (default 30) ending on the
// anchor date (default: today in Lagos), so freshly seeded dashboards look
// live and week/month analytics comparisons have real history to work with.
// Set SEED_ANCHOR_DATE=YYYY-MM-DD for a reproducible window. Re-running on a
// later day seeds the new days and leaves earlier windows as history.
const anchorDate = process.env.SEED_ANCHOR_DATE ||
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
function dayAt(offset) {
  const date = new Date(`${anchorDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const dayPatterns = {
  [dayAt(-2)]: [
    ["Danjimoh Osheimoh",36,9,2,24,36224.22,31516.25,2075.78,11.51],
    ["Odulaja Abiodun Odufuwa",16,0,0,9,38229,46411,0,13.57],
    ["Odeh Johnson Sunday",19,0,0,3,47789,55768,0,13.15],
    ["Nathaniel Richard Enang",18,0,0,11,37472,45658,0,11.68],
    ["Julius Tolulope Olatunji",0,0,0,0,0,0,0,0],
    ["Francis Eze",19,0,0,11,38116,46295,0,11.4],
    ["Sunday Moses Oluwole",0,0,0,0,0,0,0,0],
    ["John Chukwuemeka Ohakwe",14,0,0,4,36512,40983,0,12.24],
    ["Bawa Oseni Umoru",15,0,0,3,54378,59306,0,12.07],
    ["Kingsley U Nwokeocha",17,0,0,12,40306,48433,0,11.32],
    ["Peter Sunday Opoke",13,0,0,7,34836,39472,0,10.45],
    ["Thaddeus Obeh Abah",0,0,0,0,0,0,0,0.01],
    ["Yakub Aliu",14,0,0,2,35171,34421,0,11.01],
    ["Greg Okei Ossai",10,0,0,8,31932,31357,0,10.17],
    ["Gakurnan Tapauro Moses",0,0,0,37,0,0,0,6.83],
    ["Godfrey Nashel",9,0,0,81,14278,14046,0,9.44]
  ],
  [dayAt(-1)]: [
    ["Danjimoh Osheimoh",63,9,3,51,28144.3,24551.44,1655.7,10.9],
    ["Nathaniel Richard Enang",19,0,0,7,43670,52006,0,10.75],
    ["Julius Tolulope Olatunji",10,0,0,6,25450,30159,0,11.55],
    ["Yakub Aliu",18,0,0,10,47319,46293,0,12.37],
    ["Odulaja Abiodun Odufuwa",0,0,0,0,0,0,0,0],
    ["Thaddeus Obeh Abah",5,0,0,1,34679,34420,0,13.47],
    ["Francis Eze",23,0,0,3,46971,54965,0,14.88],
    ["Sunday Moses Oluwole",3,0,0,0,7165,7010,0,1.71],
    ["John Chukwuemeka Ohakwe",17,0,0,4,43282,51357,0,11.97],
    ["Greg Okei Ossai",12,0,0,1,35189,34473,0,10.15],
    ["Odeh Johnson Sunday",16,0,0,0,44790,52826,0,12.88],
    ["Bawa Oseni Umoru",15,0,0,3,42003,46356,0,10.27],
    ["Kingsley U Nwokeocha",13,0,0,11,26794,32570,0,11.98],
    ["Peter Sunday Opoke",16,0,0,10,46833,54823,0,12.67],
    ["Godfrey Nashel",4,4,0,21,0,0,0,7.18],
    ["Gakurnan Tapauro Moses",3,0,0,38,9023,8877,0,9.81]
  ],
  [dayAt(0)]: [
    ["Danjimoh Osheimoh",47,10,1,36,36482.6,31741.05,2117.4,11.3],
    ["Odeh Johnson Sunday",18,0,0,2,48001,145476,0,13.34],
    ["Bawa Oseni Umoru",0,0,0,0,0,70500,0,0],
    ["Kingsley U Nwokeocha",17,0,0,19,40066,44815,0,14.32],
    ["Peter Sunday Opoke",19,0,0,6,59457,152689,0,11.34],
    ["Nathaniel Richard Enang",16,0,0,8,34293,42553,0,12.01],
    ["Julius Tolulope Olatunji",12,0,0,3,32070,36629,0,10.33],
    ["Francis Eze",28,0,0,1,56314,69848,0,13.23],
    ["Odulaja Abiodun Odufuwa",16,0,0,12,46994,133307,0,13.68],
    ["Thaddeus Obeh Abah",6,0,0,4,7357,7283,0,7.38],
    ["Sunday Moses Oluwole",25,0,0,2,56467,69997,0,12.86],
    ["Yakub Aliu",17,0,0,4,46302,67797,0,10.93],
    ["John Chukwuemeka Ohakwe",16,0,0,10,42039,50148,0,12.43],
    ["Greg Okei Ossai",11,0,0,3,33184,32475,0,10.82],
    ["Nnamdi Nwosu",0,0,0,0,0,0,0,0],
    ["Gakurnan Tapauro Moses",1,0,0,6,2068,2035,0,1.8],
    ["Godfrey Nashel",6,0,0,31,14449,14214,0,9.53]
  ]
};

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.message || body.error?.message || response.status}`);
  return body;
}

const get = (base, path) => request(base, path);
const post = (base, path, key, body) => request(base, path, {
  method: "POST",
  headers: { "Idempotency-Key": key },
  body: JSON.stringify(body)
});
const patch = (base, path, key, body) => request(base, path, {
  method: "PATCH",
  headers: { "Idempotency-Key": key },
  body: JSON.stringify(body)
});

const peoplePage = await get(foundationBase, "/identity/v1/people");
let people = peoplePage.data;
let tunde = people.find((person) => person.display_name.toLowerCase() === "tunde");
if (!tunde) {
  tunde = await post(foundationBase, "/identity/v1/people", "realistic-seed-person-manager-tunde", {
    display_name: "Tunde",
    legal_name: "Tunde",
    global_status: "active"
  });
}
const users = (await get(foundationBase, "/identity/v1/users")).data;
if (!users.some((user) => user.person_id === tunde.person_id)) {
  await post(foundationBase, "/identity/v1/users", "realistic-seed-user-manager-tunde", {
    person_id: tunde.person_id,
    roles: ["manager"],
    status: "active"
  });
}

for (const item of operators) {
  let person = people.find((candidate) => candidate.phone === item.phone || candidate.display_name.toLowerCase() === item.name.toLowerCase());
  if (!person) {
    person = await post(foundationBase, "/identity/v1/people", `realistic-seed-person-${item.externalId}`, {
      display_name: item.name,
      legal_name: item.name,
      phone: item.phone,
      global_status: "active"
    });
    people.push(person);
  }
  item.personId = person.person_id;
  if (!users.some((user) => user.person_id === person.person_id)) {
    const user = await post(foundationBase, "/identity/v1/users", `realistic-seed-user-${item.externalId}`, {
      person_id: person.person_id,
      roles: ["operator"],
      status: "active"
    });
    users.push(user);
  }
}

let vehicles = (await get(opsBase, "/ops/v1/vehicles")).data;
const demoVehicle = vehicles.find((candidate) => candidate.vehicle_id === "vehicle_demo_001");
if (demoVehicle?.status === "active") {
  await patch(opsBase, `/ops/v1/vehicles/${demoVehicle.vehicle_id}`, "realistic-seed-demo-vehicle-inactive", {
    status: "inactive"
  });
  demoVehicle.status = "inactive";
}
for (const item of operators.filter((entry) => entry.plate)) {
  let vehicle = vehicles.find((candidate) => candidate.plate === item.plate);
  if (!vehicle) {
    vehicle = await post(opsBase, "/ops/v1/vehicles", `realistic-seed-vehicle-${item.plate}`, {
      plate: item.plate,
      vehicle_type: item.type === "rider" ? "motorbike" : "car",
      amoeba_id: item.amoeba,
      make_model: item.vehicle,
      color: item.type === "rider" ? null : "Blue",
      status: "active"
    });
    vehicles.push(vehicle);
  }
  item.vehicleId = vehicle.vehicle_id;
}

let roster = (await get(opsBase, "/ops/v1/operators")).data;
const founderOperator = roster.find((candidate) => candidate.person_id === "person_founder_wole");
if (founderOperator?.operator_status === "active") {
  await patch(opsBase, `/ops/v1/operators/${founderOperator.operator_id}`, "realistic-seed-founder-not-operator", {
    operator_status: "inactive"
  });
  founderOperator.operator_status = "inactive";
}
for (const item of operators) {
  let operator = roster.find((candidate) => candidate.person_id === item.personId);
  if (!operator) {
    operator = await post(opsBase, "/ops/v1/operators", `realistic-seed-operator-${item.externalId}`, {
      person_id: item.personId,
      operator_type: item.type,
      operator_status: "active",
      amoeba_id: item.amoeba,
      site_id: item.site,
      supervisor_person_id: tunde.person_id,
      vehicle_id: item.vehicleId || null,
      daily_revenue_target_ngn: item.target
    });
    roster.push({ ...operator, platform_registrations: [] });
  }
  item.operatorId = operator.operator_id;
  const registrations = operator.platform_registrations || [];
  if (!registrations.some((registration) => registration.platform_account_id === item.account)) {
    await post(opsBase, `/ops/v1/operators/${operator.operator_id}/platform-registrations`, `realistic-seed-registration-${item.externalId}`, {
      platform_account_id: item.account,
      platform_operator_id: item.externalId,
      registration_status: "active"
    });
  }
}

// Deterministic per-operator/per-date variation so re-runs are idempotent
// and the generated month looks organic rather than repeated.
function seededHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const windowDays = Number(process.env.SEED_WINDOW_DAYS || 30);
const patternRows = Object.values(dayPatterns);
const generatedDays = {};
for (let offset = -(windowDays - 1); offset <= 0; offset++) {
  const date = dayAt(offset);
  const pattern = patternRows[seededHash(date) % patternRows.length];
  generatedDays[date] = pattern.map((row) => {
    const [name, total, completed, cancelled, noResponse, revenue, earnings, fees, hours] = row;
    const hash = seededHash(`${name}:${date}`);
    if (hash % 100 < 10) return [name, 0, 0, 0, 0, 0, 0, 0, 0]; // rest day
    const factor = 0.75 + (hash % 51) / 100;
    let scaledRevenue = Math.round(revenue * factor * 100) / 100;
    let scaledEarnings = Math.round(earnings * factor * 100) / 100;
    // Clean source anomalies: money without activity gets plausible
    // trips/hours derived from the amount, never zero-trip positive earnings.
    if (scaledRevenue === 0 && scaledEarnings > 0) scaledRevenue = Math.round(scaledEarnings * 0.85);
    let scaledTotal = Math.round(total * factor);
    if (scaledTotal === 0 && (scaledRevenue > 0 || scaledEarnings > 0)) {
      scaledTotal = Math.max(4, Math.round(scaledRevenue / 3500));
    }
    const scaledCompleted = Math.min(scaledTotal, Math.round(completed * factor));
    const scaledCancelled = Math.min(scaledTotal, Math.round(cancelled * factor));
    const scaledNoResponse = Math.min(scaledTotal, Math.round(noResponse * factor));
    let scaledHours = Math.round(hours * factor * 100) / 100;
    if (scaledHours < 2 && (scaledRevenue > 0 || scaledEarnings > 0)) scaledHours = 5 + (hash % 60) / 10;
    return [name, scaledTotal, scaledCompleted, scaledCancelled, scaledNoResponse,
      scaledRevenue, scaledEarnings, Math.round(fees * factor * 100) / 100, scaledHours];
  });
}

for (const [recordDate, rows] of Object.entries(generatedDays)) {
  for (const accountId of ["platform_bolt_lagos", "platform_uber_cars", "platform_uber_courier"]) {
    const records = rows.flatMap((row) => {
      const item = operators.find((candidate) => candidate.name === row[0] && candidate.account === accountId);
      if (!item) return [];
      const [name, total, completed, cancelled, noResponse, revenue, earnings, fees, hours] = row;
      return [{
        platform_operator_id: item.externalId,
        trips_total: total,
        trips_completed: completed,
        trips_cancelled: cancelled,
        trips_no_response: noResponse,
        trips_rejected: 0,
        ride_revenue_ngn: revenue,
        net_earnings_ngn: earnings,
        booking_fees_ngn: fees,
        cash_trips: accountId === "platform_bolt_lagos" ? total : 0,
        card_trips: accountId === "platform_bolt_lagos" ? 0 : completed,
        acceptance_pct: total ? Math.round(((total - noResponse) / total) * 10000) / 100 : 0,
        cancellation_pct: total ? Math.round((cancelled / total) * 10000) / 100 : 0,
        completion_pct: total ? Math.round((completed / total) * 10000) / 100 : 0,
        hours_online: hours,
        current_status: total || hours ? "checked_out" : "not_seen_today",
        last_seen_at: total || hours ? `${recordDate}T19:00:00+01:00` : null,
        data_quality: accountId === "platform_bolt_lagos" ? "authoritative" : "derived",
        provenance: {
          source_file: "docs/Bolt-Fleet-Report.xlsx",
          source_sheet: "Rider Daily Data",
          imported_for_development: true,
          original_name: name
        }
      }];
    });
    if (records.length) {
      await post(opsBase, "/ops/v1/ingestion-runs", `realistic-seed-ingestion-${recordDate}-${accountId}`, {
        platform_account_id: accountId,
        record_date: recordDate,
        source: "migration",
        records
      });
    }
  }
}

// A default Finance economics policy so breakeven/labour analytics have
// real assumptions from day one (admins refine it under Controls).
const economicsPolicies = (await get(opsBase, "/ops/v1/economics-policies")).data;
if (!economicsPolicies.length) {
  await post(opsBase, "/ops/v1/economics-policies", "realistic-seed-economics-policy", {
    policy_name: "Baseline daily economics",
    admin_staff_daily_cost_ngn: 50000,
    operator_labour_share_pct: 25,
    daily_overhead_ngn: 75000,
    expected_hours_per_operator: 10,
    effective_from: dayAt(-(windowDays - 1))
  });
  console.log("Seeded the baseline economics policy.");
}

console.log(`Seeded ${operators.length} operators across ${Object.keys(generatedDays).length} report dates ending ${anchorDate}.`);

// Reserved accounts and a few simulated Monnify deposits so Finance and
// Analytics cash views have data. Skipped cleanly when the Payments
// Integration service is not running.
const paymentsBase = process.env.PAYMENTS_API_BASE || "http://127.0.0.1:4040";
try {
  await fetch(`${paymentsBase}/health`).then((response) => { if (!response.ok) throw new Error("unhealthy"); });
  let provisioned = 0;
  for (const item of operators) {
    const existing = await fetch(`${paymentsBase}/payments/v1/operators/${item.operatorId}/reserved-account`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (existing.status === 404) {
      await request(paymentsBase, `/payments/v1/operators/${item.operatorId}/reserved-account`, {
        method: "POST",
        headers: { "Idempotency-Key": `realistic-seed-reserved-${item.externalId}` },
        body: JSON.stringify({
          customer_name: item.name,
          customer_email: `${item.externalId}@fleximotion.test`
        })
      });
      provisioned += 1;
    }
  }
  // Simulated deposits for the Bolt cash operator across the last three days
  // (one intentionally short so the Finance variance workflow has a case).
  const cashOperator = operators.find((item) => item.account === "platform_bolt_lagos");
  if (cashOperator) {
    for (const [offset, amount] of [[-2, 9000], [-1, 7500], [0, 5000]]) {
      await request(paymentsBase, "/payments/v1/test/simulate-deposit", {
        method: "POST",
        headers: { "Idempotency-Key": `realistic-seed-deposit-${dayAt(offset)}` },
        body: JSON.stringify({
          operator_id: cashOperator.operatorId,
          amount_ngn: amount,
          transaction_reference: `seed-dep-${dayAt(offset)}`,
          paid_at: `${dayAt(offset)}T18:30:00+01:00`
        })
      }).catch(() => {});
    }
  }
  console.log(`Payments: ${provisioned} reserved accounts provisioned; simulated deposits ensured for the cash operator.`);
} catch {
  console.log("Payments Integration not reachable — skipped reserved-account seeding.");
}
