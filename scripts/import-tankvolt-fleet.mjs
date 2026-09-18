// Registers the 10 Tankvolt T22 EV bikes from the verified fleet sheet
// (tankvolt-Fleximotion fleet-update.xlsx, Sept 2026). VINs double as the
// Tankvolt tracker device ids. Re-running is safe: existing plates are
// updated, not duplicated.
//
// Usage:
//   set -a; source ~/fleximos-data/fleximos.env; set +a
//   node scripts/import-tankvolt-fleet.mjs [--amoeba amoeba_mainland]
//
// Notes from the sheet:
// - Bike 1 (VIN ...000836) is NOT on site and has no plate yet — imported
//   with a placeholder plate and status "inactive" until it arrives.
// - The 11th bike (VIN ...000832) is NOT in Tankvolt's system and is
//   deliberately excluded, as are the Orbit and Qlink PMS bikes (owner
//   decision, 18 Sep 2026: import those later).

const opsBase = process.env.OPS_API_BASE || "http://127.0.0.1:4030";
const token = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";
const amoebaArgIndex = process.argv.indexOf("--amoeba");
const amoebaId = amoebaArgIndex > -1 ? process.argv[amoebaArgIndex + 1] : "amoeba_mainland";

const FLEET = [
  { vin: "LB7KP2101TF000836", motor: "260130H0126", battery: "BT207205015HYCY260225146", charger: "22016050001", plate: "TVT-000836", status: "inactive", note: "not on site yet" },
  { vin: "LB7KP2103TF000854", motor: "260130H0124", battery: "BT207205015HYCY260225123", charger: "22016050005", plate: "BDG608QT", status: "active" },
  { vin: "LB7KP2102TF000828", motor: "260130H0015", battery: "BT207205015HYCY260225176", charger: "22016050010", plate: "BDG605QT", status: "active" },
  { vin: "LB7KP2100TF000777", motor: "260130H0160", battery: "BT207205015HYCY260225092", charger: "22016050018", plate: "BDG602QT", status: "active" },
  { vin: "LB7KP2104TF000779", motor: "260130H0140", battery: "BT207205015HYCY260225451", charger: "22016050024", plate: "BDG612QT", status: "active" },
  { vin: "LB7KP2104TF000751", motor: "260130H0024", battery: "BT207205015HYCY260225041", charger: "22016050046", plate: "BDG609QT", status: "active" },
  { vin: "LB7KP2107TF000842", motor: "260130H0168", battery: "BT207205015HYCY260225070", charger: "22016050051", plate: "BDG616QT", status: "active" },
  { vin: "LB7KP2107TF000808", motor: "260130H0078", battery: "BT207205015HYCY260225469", charger: "22016050053", plate: "BDG619QT", status: "active" },
  { vin: "LB7KP2101TF000822", motor: "260130H0037", battery: "BT207205015HYCY260225003", charger: "22016050060", plate: "BDG603QT", status: "active" },
  { vin: "LB7KP2100TF000813", motor: "260130H0057", battery: "BT207205015HYCY260225117", charger: "22016050072", plate: "BDG601QT", status: "active" }
];

async function request(path, options = {}) {
  const response = await fetch(`${opsBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.message || response.status}`);
  return body;
}

const existing = await request("/ops/v1/vehicles");
const byPlate = new Map(existing.data.map((vehicle) => [vehicle.plate.toUpperCase(), vehicle]));

let created = 0, updated = 0;
for (const bike of FLEET) {
  const payload = {
    plate: bike.plate,
    vehicle_type: "motorbike",
    amoeba_id: amoebaId,
    make_model: "Tankvolt T22 (EV)",
    status: bike.status,
    tracker_device_id: bike.vin,
    tracker_provider: "tankvolt"
  };
  const current = byPlate.get(bike.plate.toUpperCase());
  if (current) {
    await request(`/ops/v1/vehicles/${current.vehicle_id}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": `tankvolt-update-${bike.vin}` },
      body: JSON.stringify(payload)
    });
    updated++;
  } else {
    await request("/ops/v1/vehicles", {
      method: "POST",
      headers: { "Idempotency-Key": `tankvolt-import-${bike.vin}` },
      body: JSON.stringify(payload)
    });
    created++;
  }
  console.log(`✓ ${bike.plate} — VIN ${bike.vin}${bike.note ? ` (${bike.note})` : ""}`);
}
console.log(`Tankvolt fleet import complete: ${created} created, ${updated} updated (amoeba ${amoebaId}).`);
console.log("Battery/charger serials stay on the sheet; live battery IDs arrive with each GPS capture.");
