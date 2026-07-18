const state = {
  people: [],
  amoebas: [],
  operators: [],
  board: [],
  allPerformance: [],
  availableDates: [],
  selectedDates: [],
  performance: [],
  priorPerformance: [],
  priorWeekPerformance: [],
  economicsPolicies: [],
  alerts: [],
  cashStatus: [],
  reservedAccounts: [],
  transactions: [],
  paymentsAvailable: false,
  amoebaSummaries: [],
  operatorRows: [],
  operatorSort: "attention",
  leaderboardSort: "net",
  periodMode: "day",
  operatingDate: null
};

const ids = [
  "connectionText", "dateFrom", "dateTo", "netEarningsTotal", "netEarningsGrowth",
  "netEarningsWeek", "hourlyEfficiencyCard", "hourlyEfficiency", "hourlyEfficiencyNote",
  "hourlyEfficiencyThreshold", "utilisationMetric", "utilisationNote",
  "cashVarianceMetric", "cashVarianceNote", "alertGroupCount", "alertGroupNote",
  "notice", "paceContext", "paceLabel", "pacePercent", "paceBar", "carNetEarnings",
  "bikeNetEarnings", "tripTotal", "dataQuality", "attentionContext", "attentionList",
  "vehicleMixChart", "dataQualityImpactChart", "trendLegend", "trendChart", "economicsAssumptions", "breakevenStatus",
  "breakevenContext", "expectedLabourCost", "netContribution", "dailyOverheads",
  "breakevenVariance", "cashOnHandNote", "cashOnHand", "upcomingPayments", "platformMixChart",
  "amoebaComparisonChart", "updatedLabel", "amoebaPortfolio", "operatorSignals",
  "operatorLeaderboard", "leakageSummaryChart", "leakageList", "exportAnalyticsCsv", "detailDialog", "detailTitle", "detailSummary", "detailBody"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const query = new URLSearchParams(location.search);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const paymentsBase = query.get("paymentsApiBase") || window.flexiServiceBase("payments", 4040);
const token = window.flexiServiceToken();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const overrides = {
  expectedHoursPerOperator: query.has("expectedHoursPerOperator"),
  labourCostPerHour: query.has("labourCostPerHour"),
  adminLabourCost: query.has("adminLabourCostNg") || query.has("adminLabourCost"),
  operatorLabourSharePct: query.has("operatorLabourSharePct") || query.has("operatorLabourPct"),
  dailyOverheadAssumption: query.has("dailyOverheadsNg") || query.has("dailyOverheads")
};
let expectedHoursPerOperator = Number(query.get("expectedHoursPerOperator") || 10);
let labourCostPerHour = Number(query.get("labourCostPerHour") || 0);
let adminLabourCost = Number(query.get("adminLabourCostNg")) || Number(query.get("adminLabourCost")) || 0;
let operatorLabourSharePct = Number(query.get("operatorLabourSharePct")) || Number(query.get("operatorLabourPct")) || 0;
let dailyOverheadAssumption = Number(query.get("dailyOverheadsNg")) || Number(query.get("dailyOverheads")) || 0;
el.dateFrom.value = today;
el.dateTo.value = today;

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (value) => `₦${Number(value || 0).toLocaleString()}`;
const percent = (value) => `${Math.round(Number(value || 0))}%`;
const personName = (id) => state.people.find((item) => item.person_id === id)?.display_name || id || "Unassigned";
const amoebaName = (id) => state.amoebas.find((item) => item.amoeba_id === id)?.name || id || "Unassigned";
const liveStatus = (status) => !["offline", "not_seen_today"].includes(status);
const netEarningsOf = (row) => Number(row.net_earnings_ngn ?? row.ride_revenue_ngn ?? 0);
const dateKey = (value) => String(value || "").slice(0, 10);

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Request failed: ${response.status}`);
  return body;
}
const ops = (path, options) => request(opsBase, path, options);
const foundation = (path) => request(foundationBase, path);
const payments = (path, options) => request(paymentsBase, path, options);

function connection(status, text) {
  const root = document.querySelector(".connection-status");
  root.classList.remove("connected", "error");
  if (status) root.classList.add(status);
  el.connectionText.textContent = text;
}

function totalsFrom(rows) {
  return rows.reduce((totals, row) => {
    const value = netEarningsOf(row);
    const type = row.platform_vehicle_type || row.vehicle_type || row.platforms?.find((item) => item.vehicle_type)?.vehicle_type;
    totals.netEarnings += value;
    totals.expected += Number(row.expected_revenue_ngn || 0);
    totals.trips += Number(row.trips_completed || 0);
    totals.hours += Number(row.hours_online || 0);
    if (type === "car") totals.cars += value;
    if (type === "motorbike") totals.bikes += value;
    return totals;
  }, { netEarnings: 0, expected: 0, trips: 0, hours: 0, cars: 0, bikes: 0 });
}

function cssWidth(value) {
  return `${Math.max(0, Math.min(100, Math.round(value || 0)))}%`;
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00+01:00`);
  next.setDate(next.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(next);
}

function periodLength() {
  return Math.max(1, state.rangeDays || 1);
}

function periodLabel() {
  if (!state.dateFrom || state.dateFrom === state.dateTo) return state.operatingDate;
  return `${state.rangeDays} days ending ${state.dateTo}`;
}

function datesForPeriod(endDate, length = periodLength()) {
  const ordered = state.availableDates.slice().sort();
  return ordered.filter((date) => date <= endDate).slice(-length);
}

function rowsForDates(rows, dates) {
  const wanted = new Set(dates);
  return rows.filter((row) => wanted.has(dateKey(row.record_date)));
}

function syncPeriodModeButtons() {
  document.querySelectorAll("[data-period-mode]").forEach((button) => {
    const active = button.dataset.periodMode === state.periodMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

// The Day / Week / Month buttons are presets: they keep the current To
// date and pull From back 0, 6, or 29 days. Custom From/To works directly.
function setPeriodMode(mode) {
  state.periodMode = mode;
  const to = el.dateTo.value || today;
  const length = mode === "month" ? 29 : mode === "week" ? 6 : 0;
  el.dateTo.value = to;
  el.dateFrom.value = addDays(to, -length);
  syncPeriodModeButtons();
  refresh().catch(showError);
}

function exportAnalyticsCsv() {
  const headers = [
    "section", "period_mode", "operating_date", "period_dates", "amoeba", "operator",
    "vehicle_type", "vehicle_plate", "platform", "net_earnings_ngn", "expected_ngn",
    "hourly_efficiency_ngn", "trips_completed", "hours_online", "acceptance_rate_pct",
    "cash_variance_ngn", "cash_status", "current_status", "data_quality"
  ];
  const periodDates = state.selectedDates.join(";");
  const performanceRows = state.performance.map((row) => [
    "performance", state.periodMode, state.operatingDate, periodDates,
    amoebaName(operatorMeta(row.operator_id).amoeba_id || row.amoeba_id),
    personName(operatorMeta(row.operator_id).person_id || row.operator_id),
    row.platform_vehicle_type || operatorMeta(row.operator_id).vehicle_type || "",
    operatorMeta(row.operator_id).vehicle_plate || "",
    row.platform_display_name || row.platform || "",
    netEarningsOf(row),
    Number(row.expected_revenue_ngn || 0),
    "",
    Number(row.trips_completed || 0),
    Number(row.hours_online || 0),
    Number(row.acceptance_rate_pct || 0),
    "",
    "",
    "",
    row.data_quality || ""
  ]);
  const amoebaRows = state.amoebaSummaries.map((team) => [
    "amoeba", state.periodMode, state.operatingDate, periodDates,
    amoebaName(team.amoeba),
    personName(team.supervisor),
    "",
    "",
    "",
    team.netEarnings,
    team.expected,
    team.efficiency,
    team.trips,
    team.hours,
    "",
    team.variance,
    team.variance < 0 ? "shortfall" : team.variance > 0 ? "credit" : "clear",
    `${team.active}/${team.rows.length} active`,
    ""
  ]);
  const operatorRows = state.operatorRows.map((row) => [
    "operator", state.periodMode, state.operatingDate, periodDates,
    amoebaName(row.amoeba_id),
    personName(row.person_id),
    row.vehicle_type || "",
    row.vehicle_plate || "",
    "",
    row.netEarnings,
    Number(row.expected_revenue_ngn || 0),
    row.efficiency,
    row.tripsCompleted,
    row.hoursOnline,
    row.acceptanceRate,
    row.cashVariance,
    row.cashStatus,
    row.current_status,
    ""
  ]);
  const safeDate = state.operatingDate || today;
  downloadCsv(`fleximotion-analytics-${state.periodMode}-${safeDate}.csv`, headers, [...amoebaRows, ...operatorRows, ...performanceRows]);
}

function comparisonText(current, baseline, label) {
  if (!baseline) return `No ${label} data`;
  const change = (current - baseline) / baseline * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs ${label}`;
}

function labourModel(netEarnings, expectedLabourHours) {
  const operatorLabourCost = netEarnings * operatorLabourSharePct / 100;
  const configuredLabourCost = adminLabourCost + operatorLabourCost;
  const fallbackLabourCost = expectedLabourHours * labourCostPerHour;
  const totalLabourCost = configuredLabourCost || fallbackLabourCost;
  const effectiveHourlyCost = expectedLabourHours ? totalLabourCost / expectedLabourHours : 0;
  const configured = Boolean(configuredLabourCost || labourCostPerHour);
  const mode = configuredLabourCost
    ? `${money(adminLabourCost)} fixed admin + ${operatorLabourSharePct}% operator share`
    : `${money(labourCostPerHour)}/h labour floor`;
  return { adminLabourCost, operatorLabourCost, totalLabourCost, effectiveHourlyCost, configured, mode };
}

function applyEconomicsPolicy() {
  const policy = state.economicsPolicies
    .filter((item) => String(item.effective_from).slice(0, 10) <= state.operatingDate && (!item.effective_to || String(item.effective_to).slice(0, 10) >= state.operatingDate))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)) || String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!policy) return;
  if (!overrides.expectedHoursPerOperator) expectedHoursPerOperator = Number(policy.expected_hours_per_operator || 10);
  if (!overrides.adminLabourCost) adminLabourCost = Number(policy.admin_staff_daily_cost_ngn || 0);
  if (!overrides.operatorLabourSharePct) operatorLabourSharePct = Number(policy.operator_labour_share_pct || 0);
  if (!overrides.dailyOverheadAssumption) dailyOverheadAssumption = Number(policy.daily_overhead_ngn || 0);
  if (!overrides.labourCostPerHour) labourCostPerHour = 0;
}

function dailyNetEarningsSeries() {
  const grouped = state.allPerformance.reduce((map, row) => {
    const key = dateKey(row.record_date);
    map.set(key, (map.get(key) || 0) + netEarningsOf(row));
    return map;
  }, new Map());
  return [...grouped.entries()]
    .map(([date, netEarnings]) => ({ date, netEarnings }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderTrendChart(series) {
  const windowed = series.filter((point) => point.date <= state.dateTo).slice(-Math.max(7, state.rangeDays || 1));
  const byDate = new Map(series.map((point) => [point.date, point.netEarnings]));
  const paired = windowed.map((point) => ({ ...point, priorWeek: byDate.get(addDays(point.date, -7)) || 0 }));
  const max = Math.max(1, ...paired.flatMap((point) => [point.netEarnings, point.priorWeek]));
  const priorCount = paired.filter((point) => point.priorWeek > 0).length;
  el.trendLegend.textContent = windowed.length ? `${windowed[0].date} to ${windowed[windowed.length - 1].date}` : "No trend data";
  const currentLabel = state.periodMode === "month" ? "Current 30 days" : state.periodMode === "week" ? "Current week" : "Selected week context";
  el.trendChart.innerHTML = windowed.length ? `
    ${priorCount ? "" : `<p class="trend-warning">No prior-week data exists before ${escapeHtml(windowed[0].date)} — the bars below show the selected days only, with no last-week comparison.</p>`}
    <div class="chart-legend"><span><i class="current"></i>${currentLabel}</span>${priorCount ? '<span><i class="prior"></i>Same weekday last week</span>' : ""}</div>
    <div class="bar-chart">
      ${paired.map((point) => {
        const height = Math.max(6, Math.round(point.netEarnings / max * 100));
        const priorHeight = point.priorWeek ? Math.max(4, Math.round(point.priorWeek / max * 100)) : 0;
        const selected = point.date === state.operatingDate ? "selected" : "";
        return `<button type="button" class="bar-column ${selected}" data-detail-type="trend-day" data-detail-id="${escapeHtml(point.date)}" aria-label="Open ${escapeHtml(point.date)} Net Earnings detail">
          <div class="bar-value">${money(point.netEarnings)}${point.priorWeek ? `<small>${money(point.priorWeek)} last wk</small>` : ""}</div>
          <div class="bar-stack">
            ${priorHeight ? `<span class="bar-prior" style="height:${priorHeight}%"></span>` : ""}
            <span class="bar-current" style="height:${height}%"></span>
          </div>
          <small>${escapeHtml(point.date.slice(5))}</small>
        </button>`;
      }).join("")}
    </div>` : '<div class="empty">No Net Earnings trend data is available.</div>';
}

function renderVehicleMix(cars, bikes) {
  const total = cars + bikes;
  const carPct = total ? cars / total * 100 : 0;
  const bikePct = total ? bikes / total * 100 : 0;
  el.vehicleMixChart.innerHTML = `
    <div class="split-row"><span>Cars</span><strong>${percent(carPct)}</strong></div>
    <div class="split-track"><span class="car" style="width:${cssWidth(carPct)}"></span></div>
    <div class="split-row"><span>Bikes</span><strong>${percent(bikePct)}</strong></div>
    <div class="split-track"><span class="bike" style="width:${cssWidth(bikePct)}"></span></div>`;
}

function qualityBucket(row) {
  const quality = String(row.data_quality || "authoritative").toLowerCase();
  if (["stale", "missing"].includes(quality)) return "stale";
  if (["derived", "estimated"].includes(quality)) return "derived";
  return "authoritative";
}

function qualityLabel(bucket) {
  if (bucket === "authoritative") return "Authoritative";
  if (bucket === "derived") return "Derived";
  return "Stale / missing";
}

function dataQualitySummary() {
  const buckets = {
    authoritative: { key: "authoritative", rows: 0, netEarnings: 0 },
    derived: { key: "derived", rows: 0, netEarnings: 0 },
    stale: { key: "stale", rows: 0, netEarnings: 0 }
  };
  state.performance.forEach((row) => {
    const bucket = buckets[qualityBucket(row)];
    bucket.rows += 1;
    bucket.netEarnings += netEarningsOf(row);
  });
  const totalRows = state.performance.length;
  const totalNetEarnings = Object.values(buckets).reduce((sum, item) => sum + item.netEarnings, 0);
  const affectedRows = buckets.derived.rows + buckets.stale.rows;
  const affectedNetEarnings = buckets.derived.netEarnings + buckets.stale.netEarnings;
  return { buckets, totalRows, totalNetEarnings, affectedRows, affectedNetEarnings };
}

function renderDataQualityImpact(summary) {
  const rows = [summary.buckets.authoritative, summary.buckets.derived, summary.buckets.stale];
  const total = Math.max(1, summary.totalNetEarnings);
  el.dataQualityImpactChart.innerHTML = rows.map((item) => {
    const pct = item.netEarnings / total * 100;
    const kind = item.key === "authoritative" ? "" : item.key === "derived" ? "warning" : "critical";
    return `<button type="button" data-detail-type="data-quality" aria-label="Open data quality impact">
      <span>${qualityLabel(item.key)}</span>
      <i class="${kind}" style="width:${cssWidth(pct)}"></i>
      <strong>${money(item.netEarnings)} · ${item.rows}</strong>
    </button>`;
  }).join("");
}

function renderPlatformMix() {
  const platformTotals = [...state.performance.reduce((map, row) => {
    const label = row.platform_display_name || row.platform || "Unknown platform";
    map.set(label, (map.get(label) || 0) + netEarningsOf(row));
    return map;
  }, new Map()).entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const total = platformTotals.reduce((sum, item) => sum + item.value, 0);
  el.platformMixChart.innerHTML = platformTotals.length ? platformTotals.map((item) => `
    <div class="split-row"><span>${escapeHtml(item.label)}</span><strong>${money(item.value)}</strong></div>
    <div class="split-track"><span style="width:${cssWidth(total ? item.value / total * 100 : 0)}"></span></div>
  `).join("") : '<div class="empty">No platform mix is available for this date.</div>';
}

function renderEconomics(totals, expectedLabourHours) {
  const labour = labourModel(totals.netEarnings, expectedLabourHours);
  const expectedLabourCost = labour.totalLabourCost;
  const contribution = totals.netEarnings - expectedLabourCost;
  const breakeven = contribution - dailyOverheadAssumption;
  const accountBalance = state.reservedAccounts.reduce((sum, account) => sum + Number(account.current_balance_ngn ?? account.balance_ngn ?? 0), 0);
  const cashOnHand = state.transactions
    .filter((item) => ["delivered_to_ops", "reconciled", "settled", "finance_approved"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.amount_ngn ?? item.amount ?? 0), 0);
  el.economicsAssumptions.textContent = `${expectedHoursPerOperator}h/operator · ${labour.mode} · ${money(dailyOverheadAssumption)} overhead`;
  el.expectedLabourCost.textContent = money(expectedLabourCost);
  el.netContribution.textContent = money(contribution);
  el.dailyOverheads.textContent = money(dailyOverheadAssumption);
  el.breakevenVariance.textContent = money(breakeven);
  el.breakevenStatus.textContent = breakeven >= 0 ? "Above breakeven" : "Below breakeven";
  el.breakevenContext.textContent = labour.configured || dailyOverheadAssumption
    ? `${money(totals.netEarnings)} Net Earnings less ${money(expectedLabourCost)} labour cost and ${money(dailyOverheadAssumption)} overhead — assumptions come from the active Finance economics policy.`
    : "No Finance economics policy is active for this date. An admin sets labour costs, overheads and expected hours in the Ops admin console under Controls → Finance economics policy.";
  el.cashOnHand.textContent = state.paymentsAvailable ? money(accountBalance || cashOnHand) : "Unavailable";
  el.cashOnHandNote.textContent = state.paymentsAvailable
    ? accountBalance
      ? `Monnify reserved-account balance across ${state.reservedAccounts.length} accounts.`
      : `${state.reservedAccounts.length} reserved accounts visible; using ${state.transactions.length} payment transactions until balance sync is wired.`
    : "Payments Integration is unavailable, so cash on hand is not shown.";
  el.upcomingPayments.textContent = query.get("upcomingPaymentsNg")
    ? money(Number(query.get("upcomingPaymentsNg")))
    : "Not configured";
  renderPlatformMix();
}

function renderAmoebaComparison(amoebas) {
  const maxNet = Math.max(1, ...amoebas.map((team) => team.netEarnings));
  const maxHe = Math.max(1, ...amoebas.map((team) => team.efficiency));
  el.amoebaComparisonChart.innerHTML = amoebas.length ? `
    <div class="comparison-chart">
      ${amoebas.map((team, index) => {
        const utilisation = team.rows.length ? team.active / team.rows.length * 100 : 0;
        const varianceLabel = team.variance < 0 ? "shortfall" : team.variance > 0 ? "credit" : "clear";
        const pace = team.expected ? team.netEarnings / team.expected * 100 : 0;
        const heTarget = labourCostPerHour || Math.max(1, team.efficiency);
        const heScore = heTarget ? team.efficiency / heTarget * 100 : 0;
        const cashScore = team.variance < 0 ? 0 : 100;
        return `<article class="comparison-row">
          <div><strong>#${index + 1} ${escapeHtml(amoebaName(team.amoeba))}</strong><small>${escapeHtml(personName(team.supervisor))} · score ${Math.round(team.score)}/100</small></div>
          <div class="comparison-bars">
            <div><span>Score</span><i class="${team.score >= 75 ? "good" : team.score >= 50 ? "warning" : "critical"}" style="width:${cssWidth(team.score)}"></i><strong>${Math.round(team.score)}/100</strong></div>
            <div><span>Pace</span><i class="${pace >= 100 ? "good" : pace >= 85 ? "warning" : "critical"}" style="width:${cssWidth(pace)}"></i><strong>${percent(pace)} · ${money(team.netEarnings)}</strong></div>
            <div><span>HE</span><i class="${labourCostPerHour && team.efficiency < labourCostPerHour ? "critical" : "good"}" style="width:${cssWidth(team.efficiency / maxHe * 100)}"></i><strong>${money(team.efficiency)}/h${labourCostPerHour ? ` · ${team.efficiency >= labourCostPerHour ? "above" : "below"} labour` : ""}</strong></div>
            <div><span>Utilisation</span><i class="${utilisation >= 80 ? "good" : utilisation >= 60 ? "warning" : "critical"}" style="width:${cssWidth(utilisation)}"></i><strong>${percent(utilisation)}</strong></div>
            <div><span>Cash</span><i class="${cashScore ? "good" : "critical"}" style="width:${cssWidth(cashScore)}"></i><strong>${escapeHtml(varianceLabel)} ${money(team.variance)}</strong></div>
          </div>
          <span class="pill ${team.variance < 0 ? "open" : team.variance > 0 ? "pending" : ""}">${escapeHtml(varianceLabel)} ${money(team.variance)}</span>
        </article>`;
      }).join("")}
    </div>` : '<div class="empty">No amoeba comparison data is available.</div>';
}

function renderLeakageSummary(items) {
  const max = Math.max(1, ...items.map((item) => item.count));
  el.leakageSummaryChart.innerHTML = `
    <div class="horizontal-bars">
      ${items.map((item) => `<button type="button" class="horizontal-bar" data-detail-type="leakage-group" data-detail-id="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.label)}">
        <span>${escapeHtml(item.label)}</span>
        <i class="${escapeHtml(item.kind || "")}" style="width:${cssWidth(item.count / max * 100)}"></i>
        <strong>${escapeHtml(item.count)}</strong>
      </button>`).join("")}
    </div>`;
}

function groupByAmoeba(rows = state.board) {
  return [...rows.reduce((groups, row) => {
    const operator = state.operators.find((item) => item.operator_id === row.operator_id);
    const supervisor = operator?.supervisor_person_id || "unassigned";
    const amoeba = operator?.amoeba_id || row.amoeba_id || "unassigned";
    const id = `${supervisor}:${amoeba}`;
    if (!groups.has(id)) groups.set(id, { supervisor, amoeba, rows: [] });
    groups.get(id).rows.push(row);
    return groups;
  }, new Map()).values()];
}

function operatorMeta(operatorId) {
  return state.operators.find((item) => item.operator_id === operatorId) || {};
}

function operatorIdsForAmoeba(amoebaId) {
  return new Set(state.operators.filter((operator) => operator.amoeba_id === amoebaId).map((operator) => operator.operator_id));
}

function performanceForOperatorIds(rows, ids) {
  return rows.filter((row) => ids.has(row.operator_id));
}

function performanceSummaryByOperator(rows) {
  return rows.reduce((map, record) => {
    const current = map.get(record.operator_id) || {
      netEarnings: 0,
      expected: 0,
      tripsCompleted: 0,
      hoursOnline: 0,
      acceptanceWeighted: 0,
      acceptanceWeight: 0
    };
    const trips = Number(record.trips_completed || 0);
    current.netEarnings += netEarningsOf(record);
    current.expected += Number(record.expected_revenue_ngn || 0);
    current.tripsCompleted += trips;
    current.hoursOnline += Number(record.hours_online || 0);
    current.acceptanceWeighted += Number(record.acceptance_rate_pct || 0) * Math.max(1, trips);
    current.acceptanceWeight += Math.max(1, trips);
    map.set(record.operator_id, current);
    return map;
  }, new Map());
}

function boardRowsForSelectedPeriod(performanceByOperator) {
  return state.board.map((row) => {
    const summary = performanceByOperator.get(row.operator_id);
    if (!summary) return row;
    return {
      ...row,
      net_earnings_ngn: summary.netEarnings,
      expected_revenue_ngn: summary.expected || row.expected_revenue_ngn,
      trips_completed: summary.tripsCompleted,
      hours_online: summary.hoursOnline
    };
  });
}

function breakdown(rows, keyFactory) {
  return [...rows.reduce((map, row) => {
    const key = keyFactory(row);
    const current = map.get(key) || { label: key, netEarnings: 0, trips: 0, hours: 0, rows: 0 };
    current.netEarnings += netEarningsOf(row);
    current.trips += Number(row.trips_completed || 0);
    current.hours += Number(row.hours_online || 0);
    current.rows += 1;
    map.set(key, current);
    return map;
  }, new Map()).values()].sort((a, b) => b.netEarnings - a.netEarnings);
}

function comparisonClass(current, baseline) {
  if (!baseline) return "unavailable";
  const change = (current - baseline) / baseline * 100;
  if (change >= 10) return "";
  if (change >= -10) return "pending";
  return "open";
}

function decisionCue({ pace, he, labourCost, utilisation, variance, alerts }) {
  if (variance < 0) return `Finance leakage first: ${money(Math.abs(variance))} shortfall needs ownership before growth interpretation.`;
  if (labourCost && he < labourCost) return `Efficiency problem: HE is ${money(labourCost - he)}/h below labour cost, so growth is not yet profitable.`;
  if (pace < 85) return "Demand or execution is behind target pace; check platform mix and operator availability before end of day.";
  if (utilisation < 70) return "Capacity is underused; move supervisor attention to inactive assets and location guidance.";
  if (alerts) return "Performance is acceptable but unresolved alerts can still hide leakage or asset risk.";
  return "Healthy operating signal: pace, HE, utilisation and cash are all within acceptable control bands.";
}

function breakdownMarkup(rows, total, emptyText) {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return rows.map((item) => {
    const share = total ? item.netEarnings / total * 100 : 0;
    return `<article class="data-row">
      <div><strong>${escapeHtml(item.label)}</strong><small>${item.rows} source rows · ${Number(item.hours || 0).toFixed(1)}h online</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(item.netEarnings)}</strong><small>${percent(share)} of selected scope</small></div>
      <div><span class="row-label">Trips</span><strong>${Number(item.trips || 0).toLocaleString()}</strong><small>deliveries / rides</small></div>
      <div class="mini-track"><span style="width:${cssWidth(share)}"></span></div>
      <div></div>
    </article>`;
  }).join("");
}

function render() {
  syncPeriodModeButtons();
  syncOperatorSortButtons();
  const periodRows = state.performance.length ? state.performance : state.board;
  const totals = totalsFrom(periodRows);
  // Performance records carry no expected_revenue_ngn; the team board does
  // (scaled to the selected range), so pace targets always come from it.
  const boardExpected = state.board.reduce((sum, row) => sum + Number(row.expected_revenue_ngn || 0), 0);
  if (boardExpected > 0) totals.expected = boardExpected;
  const priorTotals = totalsFrom(state.priorPerformance);
  const priorWeekTotals = totalsFrom(state.priorWeekPerformance);
  const liveAssets = state.board.filter((item) => liveStatus(item.current_status)).length;
  const totalAvailableAssets = state.board.length;
  const utilisation = totalAvailableAssets ? liveAssets / totalAvailableAssets * 100 : 0;
  const selectedPeriodDays = Math.max(1, state.selectedDates.length || 1);
  const expectedLabourHours = totalAvailableAssets * expectedHoursPerOperator * selectedPeriodDays;
  const hourlyEfficiency = expectedLabourHours ? totals.netEarnings / expectedLabourHours : 0;
  const labour = labourModel(totals.netEarnings, expectedLabourHours);
  const cashTotals = state.cashStatus.reduce((memo, row) => {
    memo.expected += Number(row.expected_cash_ngn || 0);
    memo.received += Number(row.remitted_cash_ngn || 0);
    memo.net += Number(row.net_position_ngn || 0);
    memo.shortfalls += row.cash_status === "shortfall" ? 1 : 0;
    return memo;
  }, { expected: 0, received: 0, net: 0, shortfalls: 0 });
  const openAlerts = state.alerts.filter((item) => item.resolution_status !== "resolved");
  const groupedAlertTypes = new Set(openAlerts.map((item) => item.alert_type));
  const staleRows = state.performance.filter((row) => ["stale", "missing", "derived"].includes(row.data_quality));
  const qualitySummary = dataQualitySummary();
  const missingOperators = state.board.filter((row) => row.current_status === "not_seen_today");
  const offlineOperators = state.board.filter((row) => row.current_status === "offline");

  el.netEarningsTotal.textContent = money(totals.netEarnings);
  el.netEarningsGrowth.textContent = comparisonText(totals.netEarnings, priorTotals.netEarnings, state.periodMode === "day" ? "previous available day" : "previous period");
  el.netEarningsWeek.textContent = comparisonText(totals.netEarnings, priorWeekTotals.netEarnings, state.periodMode === "day" ? "same weekday last week" : "previous same-length window");
  el.hourlyEfficiency.textContent = `${money(hourlyEfficiency)}/h`;
  el.hourlyEfficiencyNote.textContent = `${money(totals.netEarnings)} / ${expectedLabourHours.toFixed(1)} expected hours`;
  el.hourlyEfficiencyCard.classList.remove("metric-good", "metric-risk", "metric-unconfigured");
  if (labour.configured) {
    const aboveLabour = hourlyEfficiency >= labour.effectiveHourlyCost;
    const delta = Math.abs(hourlyEfficiency - labour.effectiveHourlyCost);
    el.hourlyEfficiencyCard.classList.add(aboveLabour ? "metric-good" : "metric-risk");
    el.hourlyEfficiencyThreshold.textContent = `${money(delta)}/h ${aboveLabour ? "above" : "below"} ${money(labour.effectiveHourlyCost)}/h labour cost`;
  } else {
    el.hourlyEfficiencyCard.classList.add("metric-unconfigured");
    el.hourlyEfficiencyThreshold.textContent = "Set labourCostPerHour to compare against minimum";
  }
  el.utilisationMetric.textContent = percent(utilisation);
  el.utilisationNote.textContent = `${liveAssets} active / ${totalAvailableAssets} available assets`;
  el.cashVarianceMetric.textContent = money(cashTotals.net);
  el.cashVarianceNote.textContent = `${money(cashTotals.expected)} expected, ${money(cashTotals.received)} received`;
  el.alertGroupCount.textContent = groupedAlertTypes.size;
  el.alertGroupNote.textContent = `${openAlerts.length} open alerts`;
  el.updatedLabel.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

  const pace = totals.expected ? totals.netEarnings / totals.expected * 100 : 0;
  el.paceContext.textContent = `${periodLabel()} selected. Target pace uses configured intraday checkpoints for day view and summed daily targets for longer periods. Accounting revenue is not shown because it is not yet defined.`;
  el.paceLabel.textContent = `${money(totals.netEarnings)} vs ${money(totals.expected)} Net Earnings target`;
  el.pacePercent.textContent = percent(pace);
  el.paceBar.style.width = cssWidth(pace);
  el.carNetEarnings.textContent = money(totals.cars);
  el.bikeNetEarnings.textContent = money(totals.bikes);
  el.tripTotal.textContent = totals.trips.toLocaleString();
  el.dataQuality.textContent = `${percent(qualitySummary.affectedNetEarnings / Math.max(1, qualitySummary.totalNetEarnings) * 100)} Net Earnings affected`;
  renderVehicleMix(totals.cars, totals.bikes);
  renderDataQualityImpact(qualitySummary);
  renderTrendChart(dailyNetEarningsSeries());
  renderEconomics(totals, expectedLabourHours);

  const attention = [
    ["cash-shortfalls", "Cash shortfalls", cashTotals.shortfalls, cashTotals.shortfalls ? "critical" : ""],
    ["missing-operators", "Missing operators", missingOperators.length, missingOperators.length ? "pending" : ""],
    ["offline-operators", "Offline after dispatch", offlineOperators.length, offlineOperators.length ? "pending" : ""],
    ["data-quality", "Stale or derived source rows", staleRows.length, staleRows.length ? "pending" : ""]
  ];
  el.attentionContext.textContent = attention.some((item) => item[2]) ? "Grouped issues are ready for drilldown below." : "No grouped attention items are currently visible.";
  el.attentionList.innerHTML = attention.map(([id, label, count, kind]) => `<button type="button" class="checklist-action" data-detail-type="attention" data-detail-id="${escapeHtml(id)}"><span>${escapeHtml(label)}</span><strong class="${kind}">${count}</strong></button>`).join("");

  const performanceByOperator = performanceSummaryByOperator(periodRows);
  const periodBoardRows = boardRowsForSelectedPeriod(performanceByOperator);
  const amoebas = groupByAmoeba(periodBoardRows).map((team) => {
    const teamTotals = totalsFrom(team.rows);
    const active = team.rows.filter((item) => liveStatus(item.current_status)).length;
    const expectedHours = team.rows.length * expectedHoursPerOperator * selectedPeriodDays;
    const efficiency = expectedHours ? teamTotals.netEarnings / expectedHours : 0;
    const cashRows = state.cashStatus.filter((item) => item.amoeba_id === team.amoeba);
    const variance = cashRows.reduce((sum, row) => sum + Number(row.net_position_ngn || 0), 0);
    const alerts = openAlerts.filter((item) => item.amoeba_id === team.amoeba).length;
    const utilisationScore = team.rows.length ? active / team.rows.length * 100 : 0;
    const paceScore = teamTotals.expected ? Math.min(125, teamTotals.netEarnings / teamTotals.expected * 100) : 0;
    const heTarget = labour.effectiveHourlyCost || labourCostPerHour || efficiency || 1;
    const heScore = Math.min(125, heTarget ? efficiency / heTarget * 100 : 0);
    const cashScore = variance < 0 ? 0 : 100;
    const score = paceScore * 0.35 + heScore * 0.25 + utilisationScore * 0.25 + cashScore * 0.15 - Math.min(20, alerts * 5);
    return { ...team, ...teamTotals, active, efficiency, variance, alerts, score: Math.max(0, Math.min(100, score)) };
  }).sort((a, b) => b.score - a.score || b.netEarnings - a.netEarnings);
  state.amoebaSummaries = amoebas;
  renderAmoebaComparison(amoebas);

  el.amoebaPortfolio.innerHTML = amoebas.length ? amoebas.map((team) => {
    const paceValue = team.expected ? team.netEarnings / team.expected * 100 : 0;
    const statusClass = team.score >= 75 ? "strong" : team.score >= 50 ? "attention" : "critical";
    const detailKey = `${team.supervisor}:${team.amoeba}`;
    return `<article class="summary-card ${statusClass} interactive-card" role="button" tabindex="0" data-detail-type="amoeba" data-detail-id="${escapeHtml(detailKey)}" aria-label="Open ${escapeHtml(amoebaName(team.amoeba))} details">
      <div class="card-heading">
        <div><strong>${escapeHtml(personName(team.supervisor))}</strong><small>${escapeHtml(amoebaName(team.amoeba))} · Amoeba owner</small></div>
        <span class="pill ${statusClass === "critical" ? "open" : statusClass === "attention" ? "pending" : ""}">${Math.round(team.score)}/100</span>
      </div>
      <div class="card-kpis">
        <span><strong>${money(team.netEarnings)}</strong> Net Earnings</span>
        <span><strong>${money(team.efficiency)}/h</strong> HE</span>
        <span><strong>${team.active}/${team.rows.length}</strong> utilisation</span>
        <span><strong>${money(team.variance)}</strong> cash variance</span>
      </div>
      <div class="progress-label"><span>${money(team.netEarnings)} vs ${money(team.expected)} target</span><strong>${percent(paceValue)}</strong></div>
      <div class="progress-track"><span style="width:${cssWidth(paceValue)}"></span></div>
    </article>`;
  }).join("") : '<div class="empty">No amoebas are visible in this scope.</div>';

  const cashByOperator = new Map(state.cashStatus.map((row) => [row.operator_id, row]));
  const operatorRows = periodBoardRows.map((row) => {
    const cash = cashByOperator.get(row.operator_id);
    const performance = performanceByOperator.get(row.operator_id) || { acceptanceWeighted: 0, acceptanceWeight: 0 };
    const cashVariance = Number(cash?.net_position_ngn || 0);
    const expectedHours = expectedHoursPerOperator * selectedPeriodDays;
    const attentionScore = (cashVariance < 0 ? 2 : 0)
      + (!liveStatus(row.current_status) ? 1 : 0)
      + Number(row.open_alerts || 0);
    return {
      ...row,
      netEarnings: netEarningsOf(row),
      efficiency: expectedHours ? netEarningsOf(row) / expectedHours : 0,
      cashVariance,
      cashStatus: cash?.cash_status || "clear",
      tripsCompleted: Number(row.trips_completed || 0),
      hoursOnline: Number(row.hours_online || 0),
      acceptanceRate: performance.acceptanceWeight ? performance.acceptanceWeighted / performance.acceptanceWeight : 0,
      cashPerformance: cashVariance >= 0 ? 1_000_000 + cashVariance : cashVariance,
      attentionScore
    };
  });
  operatorRows.sort(operatorComparator);
  state.operatorRows = operatorRows;
  const missingGroup = operatorRows.filter((row) => row.current_status === "not_seen_today");
  const offlineGroup = operatorRows.filter((row) => row.current_status === "offline");
  const cashGroup = operatorRows.filter((row) => row.cashVariance < 0);
  const activeGroup = operatorRows.filter((row) => liveStatus(row.current_status)).sort((a, b) => b.netEarnings - a.netEarnings);
  const topActive = activeGroup.slice(0, 3);
  const operatorGroups = [
    { id: "missing", title: "Not seen today", rows: missingGroup, className: "critical", note: "No current performance to review; action is attendance/asset follow-up." },
    { id: "offline", title: "Offline after dispatch", rows: offlineGroup, className: "attention", note: "Operators who were expected live but are currently offline." },
    { id: "cash", title: "Cash shortfalls", rows: cashGroup, className: "critical", note: "Platform expected cash exceeds Monnify/remitted cash." },
    { id: "active", title: "Top active operators", rows: topActive, className: "strong", note: "A short sample; full operator list belongs in drilldown." }
  ].filter((group) => group.rows.length);
  el.operatorSignals.innerHTML = operatorGroups.length ? operatorGroups.map((group) => {
    const net = group.rows.reduce((sum, row) => sum + row.netEarnings, 0);
    const cash = group.rows.reduce((sum, row) => sum + row.cashVariance, 0);
    const avgHe = group.rows.length ? group.rows.reduce((sum, row) => sum + row.efficiency, 0) / group.rows.length : 0;
    return `<article class="summary-card ${group.className} interactive-card" role="button" tabindex="0" data-detail-type="operator-group" data-detail-id="${escapeHtml(group.id)}" aria-label="Open ${escapeHtml(group.title)} operators">
      <div class="card-heading">
        <div><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.note)}</small></div>
        <span class="pill ${group.className === "critical" ? "open" : group.className === "attention" ? "pending" : ""}">${group.rows.length}</span>
      </div>
      <div class="card-kpis">
        <span><strong>${money(net)}</strong> Net Earnings</span>
        <span><strong>${money(avgHe)}/h</strong> avg HE</span>
        <span><strong>${money(cash)}</strong> cash variance</span>
        <span><strong>${group.rows.filter((row) => liveStatus(row.current_status)).length}</strong> live</span>
      </div>
    </article>`;
  }).join("") : '<div class="empty">No operator signals are visible for this date.</div>';
  renderOperatorLeaderboard();

  const leakageRows = [
    ...state.cashStatus.filter((row) => ["shortfall", "in_credit"].includes(row.cash_status)).map((row) => ({
      kind: "cash",
      id: row.operator_id,
      title: personName(row.person_id),
      detail: `${amoebaName(row.amoeba_id)} · ${row.vehicle_plate || "No vehicle"}`,
      metric: money(row.net_position_ngn),
      note: `${money(row.expected_cash_ngn)} platform expected, ${money(row.remitted_cash_ngn)} received`,
      status: row.cash_status,
      critical: row.cash_status === "shortfall"
    })),
    ...openAlerts.slice(0, 8).map((alert) => ({
      kind: "alert",
      id: alert.alert_id,
      title: String(alert.alert_type).replaceAll("_", " "),
      detail: `${personName(alert.person_id)} · ${amoebaName(alert.amoeba_id)}`,
      metric: `Tier ${alert.tier}`,
      note: alert.platform_display_name || "General",
      status: alert.resolution_status,
      critical: Number(alert.tier) >= 3
    }))
  ];
  renderLeakageSummary([
    { id: "cash-shortfalls", label: "Cash shortfalls", count: state.cashStatus.filter((row) => row.cash_status === "shortfall").length, kind: "critical" },
    { id: "cash-credits", label: "Cash credits", count: state.cashStatus.filter((row) => row.cash_status === "in_credit").length, kind: "warning" },
    { id: "open-alerts", label: "Open alerts", count: openAlerts.length, kind: "warning" },
    { id: "missing-operators", label: "Missing operators", count: missingOperators.length, kind: "warning" },
    { id: "data-quality", label: "Stale / derived rows", count: staleRows.length, kind: "neutral" }
  ]);
  el.leakageList.innerHTML = leakageRows.length ? leakageRows.map((row) => `
    <article class="data-row alert interactive-row ${row.critical ? "critical" : ""}" role="button" tabindex="0" data-detail-type="${row.kind === "cash" ? "operator" : "alert"}" data-detail-id="${escapeHtml(row.id)}" aria-label="Open ${escapeHtml(row.title)}">
      <div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small></div>
      <div><span class="row-label">Signal</span><strong>${escapeHtml(row.metric)}</strong><small>${escapeHtml(row.note)}</small></div>
      <div><span class="pill ${row.critical ? "open" : "pending"}">${escapeHtml(String(row.status).replaceAll("_", " "))}</span></div>
      <div></div><div></div>
    </article>`).join("") : '<div class="empty">No leakage items are visible for this operating date.</div>';
}

function operatorComparator(a, b) {
  if (state.operatorSort === "net") return b.netEarnings - a.netEarnings || b.attentionScore - a.attentionScore;
  if (state.operatorSort === "he") return b.efficiency - a.efficiency || b.netEarnings - a.netEarnings;
  if (state.operatorSort === "cash") return a.cashVariance - b.cashVariance || b.attentionScore - a.attentionScore;
  return b.attentionScore - a.attentionScore || b.netEarnings - a.netEarnings;
}

function setOperatorSort(sortKey) {
  state.operatorSort = sortKey;
  syncOperatorSortButtons();
  render();
}

function syncOperatorSortButtons() {
  document.querySelectorAll("[data-sort-operators]").forEach((button) => {
    const active = button.dataset.sortOperators === state.operatorSort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function leaderboardComparator(a, b) {
  if (state.leaderboardSort === "acceptance") return b.acceptanceRate - a.acceptanceRate || b.netEarnings - a.netEarnings;
  if (state.leaderboardSort === "trips") return b.tripsCompleted - a.tripsCompleted || b.netEarnings - a.netEarnings;
  if (state.leaderboardSort === "online") return b.hoursOnline - a.hoursOnline || b.netEarnings - a.netEarnings;
  if (state.leaderboardSort === "cash") return b.cashPerformance - a.cashPerformance || b.netEarnings - a.netEarnings;
  return b.netEarnings - a.netEarnings || b.tripsCompleted - a.tripsCompleted;
}

function metricForLeaderboard(row) {
  if (state.leaderboardSort === "acceptance") return `${Number(row.acceptanceRate || 0).toFixed(1)}%`;
  if (state.leaderboardSort === "trips") return Number(row.tripsCompleted || 0).toLocaleString();
  if (state.leaderboardSort === "online") return `${Number(row.hoursOnline || 0).toFixed(1)}h`;
  if (state.leaderboardSort === "cash") return money(row.cashVariance);
  return money(row.netEarnings);
}

function syncLeaderboardSortButtons() {
  document.querySelectorAll("[data-sort-leaderboard]").forEach((button) => {
    const active = button.dataset.sortLeaderboard === state.leaderboardSort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setLeaderboardSort(sortKey) {
  state.leaderboardSort = sortKey;
  syncLeaderboardSortButtons();
  render();
}

function renderOperatorLeaderboard() {
  syncLeaderboardSortButtons();
  const ranked = state.operatorRows.slice().sort(leaderboardComparator).slice(0, 10);
  const maxNet = Math.max(1, ...ranked.map((row) => row.netEarnings));
  el.operatorLeaderboard.innerHTML = ranked.length ? ranked.map((row, index) => {
    const rowClass = row.cashVariance < 0 || !liveStatus(row.current_status) ? "alert" : "";
    const criticalClass = row.cashVariance < 0 ? "critical" : "";
    return `<article class="data-row interactive-row ${rowClass} ${criticalClass}" role="button" tabindex="0" data-detail-type="operator" data-detail-id="${escapeHtml(row.operator_id)}" aria-label="Open ${escapeHtml(personName(row.person_id))} details">
      <div><strong>#${index + 1} ${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(amoebaName(row.amoeba_id))} · ${escapeHtml(row.vehicle_plate || row.vehicle_type || "No asset")}</small></div>
      <div><span class="row-label">Selected metric</span><strong>${escapeHtml(metricForLeaderboard(row))}</strong><small>${escapeHtml(state.leaderboardSort.replaceAll("_", " "))}</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(row.netEarnings)}</strong><small>${Number(row.tripsCompleted || 0).toLocaleString()} trips · ${Number(row.acceptanceRate || 0).toFixed(1)}% acceptance</small></div>
      <div class="mini-track"><span style="width:${cssWidth(row.netEarnings / maxNet * 100)}"></span></div>
      <div><span class="pill ${row.cashVariance < 0 ? "open" : !liveStatus(row.current_status) ? "pending" : ""}">${escapeHtml(String(row.current_status).replaceAll("_", " "))}</span></div>
    </article>`;
  }).join("") : '<div class="empty">No operator leaderboard data is visible for this operating date.</div>';
}

function openDetailDialog() {
  if (!el.detailDialog.open) el.detailDialog.showModal();
}

function showAmoebaDetail(id) {
  const team = state.amoebaSummaries.find((item) => `${item.supervisor}:${item.amoeba}` === id);
  if (!team) return;
  const operatorIds = operatorIdsForAmoeba(team.amoeba);
  const operators = state.operatorRows.filter((row) => row.amoeba_id === team.amoeba);
  const teamPerformance = performanceForOperatorIds(state.performance, operatorIds);
  const prior = totalsFrom(performanceForOperatorIds(state.priorPerformance, operatorIds));
  const priorWeek = totalsFrom(performanceForOperatorIds(state.priorWeekPerformance, operatorIds));
  const utilisation = team.rows.length ? team.active / team.rows.length * 100 : 0;
  const pace = team.expected ? team.netEarnings / team.expected * 100 : 0;
  const labour = labourModel(team.netEarnings, team.rows.length * expectedHoursPerOperator);
  const labourCost = labour.effectiveHourlyCost;
  const platformRows = breakdown(teamPerformance, (row) => row.platform_display_name || row.platform || "Unknown platform");
  const vehicleRows = breakdown(teamPerformance, (row) => row.platform_vehicle_type || row.vehicle_type || operatorMeta(row.operator_id).vehicle_type || "Unknown vehicle");
  const cue = decisionCue({ pace, he: team.efficiency, labourCost, utilisation, variance: team.variance, alerts: team.alerts });
  el.detailTitle.textContent = `${amoebaName(team.amoeba)} details`;
  el.detailSummary.textContent = `${personName(team.supervisor)} · ${operators.length} operators · ${money(team.netEarnings)} Net Earnings · ${money(team.variance)} cash variance`;
  el.detailBody.innerHTML = `
    <article class="summary-card ${team.score >= 75 ? "strong" : team.score >= 50 ? "attention" : "critical"}">
      <div class="card-heading">
        <div><strong>Decision cue</strong><small>${escapeHtml(cue)}</small></div>
        <span class="pill ${team.score < 50 ? "open" : team.score < 75 ? "pending" : ""}">${Math.round(team.score)}/100</span>
      </div>
      <div class="card-kpis">
        <span><strong>${money(team.netEarnings)}</strong> Net Earnings</span>
        <span><strong>${money(team.efficiency)}/h</strong> HE${labourCost ? ` vs ${money(labourCost)}/h labour` : ""}</span>
        <span><strong>${team.active}/${team.rows.length}</strong> Utilisation (${percent(utilisation)})</span>
        <span><strong>${team.alerts}</strong> Open alerts</span>
      </div>
      <div class="card-kpis">
        <span><strong>${comparisonText(team.netEarnings, prior.netEarnings, "previous day")}</strong> day movement</span>
        <span><strong>${comparisonText(team.netEarnings, priorWeek.netEarnings, "same weekday last week")}</strong> week movement</span>
        <span><strong>${percent(pace)}</strong> target pace</span>
        <span><strong>${money(team.variance)}</strong> cash position</span>
      </div>
    </article>
    <article class="summary-card">
      <div class="card-heading"><div><strong>Platform mix</strong><small>Where this amoeba's Net Earnings came from today.</small></div></div>
      <div class="data-list compact-list">${breakdownMarkup(platformRows, team.netEarnings, "No platform rows are available for this amoeba.")}</div>
    </article>
    <article class="summary-card">
      <div class="card-heading"><div><strong>Vehicle mix</strong><small>Cars and bikes stay separated for economics and operational decisions.</small></div></div>
      <div class="data-list compact-list">${breakdownMarkup(vehicleRows, team.netEarnings, "No vehicle rows are available for this amoeba.")}</div>
    </article>
    ${operators.map((row) => `
      <article class="data-row interactive-row ${row.cashVariance < 0 || !liveStatus(row.current_status) ? "alert" : ""}" role="button" tabindex="0" data-detail-type="operator" data-detail-id="${escapeHtml(row.operator_id)}" aria-label="Open ${escapeHtml(personName(row.person_id))} details">
        <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(row.vehicle_plate || "No vehicle")} · ${escapeHtml(row.vehicle_type || "asset")}</small></div>
        <div><span class="row-label">Net Earnings</span><strong>${money(row.netEarnings)}</strong><small>${Number(row.trips_completed || 0)} trips/deliveries</small></div>
        <div><span class="row-label">HE</span><strong>${money(row.efficiency)}/h</strong><small>${Number(row.hours_online || 0).toFixed(1)}h online</small></div>
        <div><span class="row-label">Cash variance</span><strong>${money(row.cashVariance)}</strong><small>${escapeHtml(row.cashStatus.replaceAll("_", " "))}</small></div>
        <div><span class="pill ${liveStatus(row.current_status) ? "" : "pending"}">${escapeHtml(String(row.current_status).replaceAll("_", " "))}</span></div>
      </article>`).join("")}`;
  openDetailDialog();
}

function showOperatorDetail(operatorId) {
  const row = state.operatorRows.find((item) => item.operator_id === operatorId);
  if (!row) return;
  const platformRows = state.performance.filter((item) => item.operator_id === operatorId);
  const history = state.allPerformance
    .filter((item) => item.operator_id === operatorId && dateKey(item.record_date) < state.operatingDate)
    .sort((a, b) => dateKey(b.record_date).localeCompare(dateKey(a.record_date)));
  const lastSeven = history.slice(0, 7);
  const historicalAverage = lastSeven.length ? lastSeven.reduce((sum, item) => sum + netEarningsOf(item), 0) / lastSeven.length : 0;
  const vehicleType = row.platform_vehicle_type || row.vehicle_type || operatorMeta(operatorId).vehicle_type || "asset";
  const labour = labourModel(row.netEarnings, expectedHoursPerOperator);
  const heStatus = labour.effectiveHourlyCost && row.efficiency < labour.effectiveHourlyCost
    ? `${money(labour.effectiveHourlyCost - row.efficiency)}/h below labour cost`
    : labour.effectiveHourlyCost
      ? `${money(row.efficiency - labour.effectiveHourlyCost)}/h above labour cost`
      : "Labour floor not configured";
  const operatorCue = row.current_status === "not_seen_today"
    ? "Attendance first: this operator has no useful revenue story today until they come online."
    : row.cashVariance < 0
      ? "Cash leakage first: reconcile Monnify remittance before treating performance as healthy."
      : historicalAverage
        ? comparisonText(row.netEarnings, historicalAverage, "7-day operator average")
        : "No historical operator average is available yet.";
  const alerts = state.alerts.filter((item) => item.operator_id === operatorId && item.resolution_status !== "resolved");
  el.detailTitle.textContent = `${personName(row.person_id)} details`;
  el.detailSummary.textContent = `${amoebaName(row.amoeba_id)} · ${row.vehicle_plate || "No vehicle"} · ${money(row.netEarnings)} Net Earnings`;
  el.detailBody.innerHTML = `
    <article class="summary-card ${row.cashVariance < 0 || !liveStatus(row.current_status) ? "attention" : "strong"}">
      <div class="card-heading"><div><strong>Operator signal</strong><small>${escapeHtml(operatorCue)}</small></div><span class="pill ${liveStatus(row.current_status) ? "" : "pending"}">${escapeHtml(String(row.current_status).replaceAll("_", " "))}</span></div>
      <div class="card-kpis">
        <span><strong>${money(row.netEarnings)}</strong> Net Earnings</span>
        <span><strong>${money(row.efficiency)}/h</strong> Hourly Efficiency</span>
        <span><strong>${Number(row.hours_online || 0).toFixed(1)}h</strong> Online</span>
        <span><strong>${money(row.cashVariance)}</strong> Cash variance</span>
      </div>
      <div class="card-kpis">
        <span><strong>${escapeHtml(heStatus)}</strong> HE floor</span>
        <span><strong>${historicalAverage ? money(historicalAverage) : "No avg"}</strong> 7-day avg</span>
        <span><strong>${escapeHtml(vehicleType)}</strong> vehicle type</span>
        <span><strong>${alerts.length}</strong> open alerts</span>
      </div>
    </article>
    ${platformRows.map((item) => `
      <article class="data-row">
        <div><strong>${escapeHtml(item.platform_display_name || item.platform)}</strong><small>${escapeHtml(item.platform_vehicle_type || item.vehicle_type || "asset")}</small></div>
        <div><span class="row-label">Net Earnings</span><strong>${money(item.net_earnings_ngn)}</strong><small>${Number(item.trips_completed || 0)} completed</small></div>
        <div><span class="row-label">Acceptance</span><strong>${Number(item.acceptance_rate_pct || 0).toFixed(1)}%</strong><small>${Number(item.hours_online || 0).toFixed(1)}h online</small></div>
        <div><span class="pill">${escapeHtml(String(item.data_quality || "current").replaceAll("_", " "))}</span></div>
        <div></div>
      </article>`).join("")}
    ${alerts.map((alert) => `
      <article class="data-row alert ${Number(alert.tier) >= 3 ? "critical" : ""}">
        <div><strong>${escapeHtml(String(alert.alert_type).replaceAll("_", " "))}</strong><small>${escapeHtml(alert.platform_display_name || "General")}</small></div>
        <div><span class="row-label">Tier</span><strong>Tier ${escapeHtml(alert.tier)}</strong><small>${escapeHtml(alert.resolution_status)}</small></div>
        <div></div><div></div><div></div>
      </article>`).join("")}`;
  openDetailDialog();
}

function showOperatorGroupDetail(groupId) {
  const groups = {
    missing: {
      title: "Not seen today",
      rows: state.operatorRows.filter((row) => row.current_status === "not_seen_today"),
      summary: "No Net Earnings or HE story exists yet; this is an attendance, resumption or asset-follow-up queue."
    },
    offline: {
      title: "Offline after dispatch",
      rows: state.operatorRows.filter((row) => row.current_status === "offline"),
      summary: "Operators who should be live but are currently offline."
    },
    cash: {
      title: "Cash shortfalls",
      rows: state.operatorRows.filter((row) => row.cashVariance < 0),
      summary: "Operators where expected platform cash is above Monnify/remitted cash."
    },
    active: {
      title: "Top active operators",
      rows: state.operatorRows.filter((row) => liveStatus(row.current_status)).sort((a, b) => b.netEarnings - a.netEarnings),
      summary: "Active operators ranked by Net Earnings for drilldown."
    }
  };
  const group = groups[groupId];
  if (!group) return;
  el.detailTitle.textContent = group.title;
  el.detailSummary.textContent = `${group.rows.length} operators · ${group.summary}`;
  el.detailBody.innerHTML = group.rows.length ? group.rows.map((row) => `
    <article class="data-row interactive-row ${row.cashVariance < 0 || !liveStatus(row.current_status) ? "alert" : ""}" role="button" tabindex="0" data-detail-type="operator" data-detail-id="${escapeHtml(row.operator_id)}" aria-label="Open ${escapeHtml(personName(row.person_id))} details">
      <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(amoebaName(row.amoeba_id))} · ${escapeHtml(row.vehicle_plate || row.vehicle_type || "No asset")}</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(row.netEarnings)}</strong><small>${Number(row.trips_completed || 0)} trips/deliveries</small></div>
      <div><span class="row-label">Hourly Efficiency</span><strong>${money(row.efficiency)}/h</strong><small>${expectedHoursPerOperator}h expected</small></div>
      <div><span class="row-label">Cash variance</span><strong>${money(row.cashVariance)}</strong><small>${escapeHtml(row.cashStatus.replaceAll("_", " "))}</small></div>
      <div><span class="pill ${liveStatus(row.current_status) ? "" : "pending"}">${escapeHtml(String(row.current_status).replaceAll("_", " "))}</span></div>
    </article>`).join("") : '<div class="empty">No operators are currently in this group.</div>';
  openDetailDialog();
}

function showAlertDetail(alertId) {
  const alert = state.alerts.find((item) => item.alert_id === alertId);
  if (!alert) return;
  const operator = state.operatorRows.find((row) => row.operator_id === alert.operator_id);
  el.detailTitle.textContent = String(alert.alert_type || "Alert").replaceAll("_", " ");
  el.detailSummary.textContent = `${personName(alert.person_id)} · ${amoebaName(alert.amoeba_id)} · ${alert.platform_display_name || "General"}`;
  el.detailBody.innerHTML = `
    <article class="summary-card ${Number(alert.tier) >= 3 ? "critical" : "attention"}">
      <div class="card-heading">
        <div><strong>Escalation signal</strong><small>${Number(alert.tier) >= 3 ? "High severity. Manager review should not wait for end-of-day reporting." : "Open alert. Amoeba owner should resolve or explain before escalation."}</small></div>
        <span class="pill ${Number(alert.tier) >= 3 ? "open" : "pending"}">Tier ${escapeHtml(alert.tier)}</span>
      </div>
      <div class="card-kpis">
        <span><strong>${escapeHtml(alert.resolution_status || "open")}</strong> status</span>
        <span><strong>${escapeHtml(alert.platform_display_name || "General")}</strong> source</span>
        <span><strong>${operator ? money(operator.netEarnings) : "No record"}</strong> operator Net Earnings</span>
        <span><strong>${operator ? money(operator.cashVariance) : "No cash row"}</strong> cash variance</span>
      </div>
    </article>
    ${operator ? `<article class="data-row interactive-row" role="button" tabindex="0" data-detail-type="operator" data-detail-id="${escapeHtml(operator.operator_id)}" aria-label="Open operator details">
      <div><strong>${escapeHtml(personName(operator.person_id))}</strong><small>${escapeHtml(amoebaName(operator.amoeba_id))} · ${escapeHtml(operator.vehicle_plate || "No vehicle")}</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(operator.netEarnings)}</strong><small>${Number(operator.trips_completed || 0)} trips/deliveries</small></div>
      <div><span class="row-label">HE</span><strong>${money(operator.efficiency)}/h</strong><small>${Number(operator.hours_online || 0).toFixed(1)}h online</small></div>
      <div><span class="pill ${liveStatus(operator.current_status) ? "" : "pending"}">${escapeHtml(String(operator.current_status).replaceAll("_", " "))}</span></div>
      <div></div>
    </article>` : '<div class="empty">This alert is not linked to a current operator row.</div>'}`;
  openDetailDialog();
}

function showAttentionDetail(id) {
  if (id === "data-quality") return showDataQualityDetail();
  if (id === "cash-shortfalls") return showOperatorGroupDetail("cash");
  if (id === "missing-operators") return showOperatorGroupDetail("missing");
  if (id === "offline-operators") return showOperatorGroupDetail("offline");
}

function showLeakageGroupDetail(id) {
  if (id === "cash-shortfalls") return showOperatorGroupDetail("cash");
  if (id === "cash-credits") {
    const rows = state.operatorRows.filter((row) => row.cashVariance > 0);
    return showCustomOperatorRows("Cash credits", rows, "Operators where Monnify/remitted cash is above platform-expected cash.");
  }
  if (id === "open-alerts") return showAlertGroupDetail();
  if (id === "missing-operators") return showOperatorGroupDetail("missing");
  if (id === "data-quality") return showDataQualityDetail();
}

function showCustomOperatorRows(title, rows, summary) {
  el.detailTitle.textContent = title;
  el.detailSummary.textContent = `${rows.length} operators · ${summary}`;
  el.detailBody.innerHTML = rows.length ? rows.map((row) => `
    <article class="data-row interactive-row ${row.cashVariance < 0 || !liveStatus(row.current_status) ? "alert" : ""}" role="button" tabindex="0" data-detail-type="operator" data-detail-id="${escapeHtml(row.operator_id)}" aria-label="Open ${escapeHtml(personName(row.person_id))} details">
      <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(amoebaName(row.amoeba_id))} · ${escapeHtml(row.vehicle_plate || row.vehicle_type || "No asset")}</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(row.netEarnings)}</strong><small>${Number(row.trips_completed || 0)} trips/deliveries</small></div>
      <div><span class="row-label">Cash variance</span><strong>${money(row.cashVariance)}</strong><small>${escapeHtml(row.cashStatus.replaceAll("_", " "))}</small></div>
      <div><span class="pill ${liveStatus(row.current_status) ? "" : "pending"}">${escapeHtml(String(row.current_status).replaceAll("_", " "))}</span></div>
      <div></div>
    </article>`).join("") : '<div class="empty">No operators are currently in this group.</div>';
  openDetailDialog();
}

function showAlertGroupDetail() {
  const alerts = state.alerts.filter((item) => item.resolution_status !== "resolved");
  el.detailTitle.textContent = "Open alerts";
  el.detailSummary.textContent = `${alerts.length} unresolved alerts grouped for escalation review.`;
  el.detailBody.innerHTML = alerts.length ? alerts.map((alert) => `
    <article class="data-row alert interactive-row ${Number(alert.tier) >= 3 ? "critical" : ""}" role="button" tabindex="0" data-detail-type="alert" data-detail-id="${escapeHtml(alert.alert_id)}" aria-label="Open ${escapeHtml(String(alert.alert_type).replaceAll("_", " "))}">
      <div><strong>${escapeHtml(String(alert.alert_type).replaceAll("_", " "))}</strong><small>${escapeHtml(personName(alert.person_id))} · ${escapeHtml(amoebaName(alert.amoeba_id))}</small></div>
      <div><span class="row-label">Tier</span><strong>Tier ${escapeHtml(alert.tier)}</strong><small>${escapeHtml(alert.platform_display_name || "General")}</small></div>
      <div><span class="pill ${Number(alert.tier) >= 3 ? "open" : "pending"}">${escapeHtml(alert.resolution_status || "open")}</span></div>
      <div></div><div></div>
    </article>`).join("") : '<div class="empty">No open alerts are visible for this operating date.</div>';
  openDetailDialog();
}

function showTrendDayDetail(date) {
  const rows = state.allPerformance.filter((row) => dateKey(row.record_date) === date);
  const priorRows = state.allPerformance.filter((row) => dateKey(row.record_date) === addDays(date, -7));
  const totals = totalsFrom(rows);
  const prior = totalsFrom(priorRows);
  const platforms = breakdown(rows, (row) => row.platform_display_name || row.platform || "Unknown platform");
  const vehicles = breakdown(rows, (row) => row.platform_vehicle_type || row.vehicle_type || operatorMeta(row.operator_id).vehicle_type || "Unknown vehicle");
  el.detailTitle.textContent = `${date} Net Earnings`;
  el.detailSummary.textContent = `${money(totals.netEarnings)} · ${comparisonText(totals.netEarnings, prior.netEarnings, "same weekday last week")}`;
  el.detailBody.innerHTML = `
    <article class="summary-card ${comparisonClass(totals.netEarnings, prior.netEarnings)}">
      <div class="card-heading"><div><strong>What changed?</strong><small>${prior.netEarnings ? "Compare the platform and vehicle mix below against the prior-week overlay." : "No prior-week baseline exists for this seed period."}</small></div></div>
      <div class="card-kpis">
        <span><strong>${money(totals.netEarnings)}</strong> Net Earnings</span>
        <span><strong>${money(prior.netEarnings)}</strong> last week</span>
        <span><strong>${Number(totals.trips || 0).toLocaleString()}</strong> trips/deliveries</span>
        <span><strong>${Number(totals.hours || 0).toFixed(1)}h</strong> online time</span>
      </div>
    </article>
    <article class="summary-card"><div class="card-heading"><div><strong>Platform contribution</strong><small>Demand source split for the selected day.</small></div></div><div class="data-list compact-list">${breakdownMarkup(platforms, totals.netEarnings, "No platform rows are available.")}</div></article>
    <article class="summary-card"><div class="card-heading"><div><strong>Vehicle contribution</strong><small>Cars and bikes separated for economics review.</small></div></div><div class="data-list compact-list">${breakdownMarkup(vehicles, totals.netEarnings, "No vehicle rows are available.")}</div></article>`;
  openDetailDialog();
}

function showDataQualityDetail() {
  const summary = dataQualitySummary();
  const weakRows = state.performance
    .filter((row) => qualityBucket(row) !== "authoritative")
    .sort((a, b) => netEarningsOf(b) - netEarningsOf(a));
  const affectedPct = summary.totalNetEarnings ? summary.affectedNetEarnings / summary.totalNetEarnings * 100 : 0;
  el.detailTitle.textContent = "Data quality impact";
  el.detailSummary.textContent = `${money(summary.affectedNetEarnings)} of ${periodLabel()} Net Earnings (${percent(affectedPct)}) comes from derived, stale or missing source rows.`;
  el.detailBody.innerHTML = `
    <article class="summary-card">
      <div class="card-kpis">
        <span><strong>${money(summary.totalNetEarnings)}</strong> Total Net Earnings</span>
        <span><strong>${money(summary.buckets.authoritative.netEarnings)}</strong> Authoritative</span>
        <span><strong>${money(summary.buckets.derived.netEarnings)}</strong> Derived</span>
        <span><strong>${money(summary.buckets.stale.netEarnings)}</strong> Stale / missing</span>
      </div>
    </article>
    <article class="data-row">
      <div><strong>How to read this</strong><small>Authoritative rows can drive decisions directly. Derived rows are usable but should be labelled. Stale or missing rows can hide real leakage, weak demand or operator issues.</small></div>
      <div><span class="row-label">Impact</span><strong>${percent(affectedPct)}</strong><small>${summary.affectedRows} of ${summary.totalRows} source rows</small></div>
      <div><span class="pill ${summary.affectedRows ? "pending" : ""}">${summary.affectedRows ? "Review sources" : "Clean"}</span></div>
      <div></div><div></div>
    </article>
    ${weakRows.length ? weakRows.map((row) => `
      <article class="data-row alert ${qualityBucket(row) === "stale" ? "critical" : ""}">
        <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(row.platform_display_name || row.platform || "Unknown platform")} · ${escapeHtml(row.platform_vehicle_type || row.vehicle_type || "asset")}</small></div>
        <div><span class="row-label">Net Earnings at risk</span><strong>${money(netEarningsOf(row))}</strong><small>${Number(row.trips_completed || 0)} trips/deliveries</small></div>
        <div><span class="row-label">Signal</span><strong>${escapeHtml(qualityLabel(qualityBucket(row)))}</strong><small>${escapeHtml(String(row.record_date || "").slice(0, 10))}</small></div>
        <div><span class="pill ${qualityBucket(row) === "stale" ? "open" : "pending"}">${escapeHtml(String(row.data_quality || "derived").replaceAll("_", " "))}</span></div>
        <div></div>
      </article>`).join("") : '<div class="empty">No weak source rows are visible for this period.</div>'}`;
  openDetailDialog();
}

async function refresh() {
  connection("", "Connecting");
  el.notice.classList.remove("error");
  el.notice.textContent = "Loading analytics control room...";
  const [people, amoebas, operators, allPerformance, economicsPolicies] = await Promise.all([
    foundation("/identity/v1/people"),
    foundation("/amoeba/v1/amoebas"),
    ops("/ops/v1/operators"),
    ops("/ops/v1/daily-performance"),
    ops("/ops/v1/economics-policies")
  ]);
  const dates = [...new Set(allPerformance.data.map((item) => String(item.record_date).slice(0, 10)))].sort().reverse();
  const availableDates = dates.slice().sort();
  state.availableDates = availableDates;
  let dateFrom = el.dateFrom.value || el.dateTo.value || today;
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const rangeHasData = availableDates.some((date) => date >= dateFrom && date <= dateTo);
  if (!rangeHasData && dates.length) {
    dateFrom = dates[0];
    dateTo = dates[0];
  }
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const rangeDays = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  state.dateFrom = dateFrom;
  state.dateTo = dateTo;
  state.rangeDays = rangeDays;
  state.periodMode = rangeDays === 1 ? "day" : rangeDays <= 7 ? "week" : "month";
  syncPeriodModeButtons();
  const operatingDate = dateTo;
  const singleDay = rangeDays === 1;
  const selectedDates = availableDates.filter((date) => date >= dateFrom && date <= dateTo);
  // The prior period is the same calendar length immediately before From.
  const priorTo = addDays(dateFrom, -1);
  const priorFrom = addDays(dateFrom, -rangeDays);
  const priorPeriodDates = availableDates.filter((date) => date >= priorFrom && date <= priorTo);
  const priorDate = dates.find((date) => date < operatingDate);
  const priorWeekDate = addDays(operatingDate, -7);
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const [board, dailyPerformance, priorDayPerformance, sameWeekdayPerformance, alerts, cashStatus] = await Promise.all([
    ops(`/ops/v1/team-board?${range}`),
    ops(`/ops/v1/daily-performance?${range}`),
    singleDay && priorDate ? ops(`/ops/v1/daily-performance?record_date=${priorDate}`) : Promise.resolve({ data: [] }),
    singleDay && dates.includes(priorWeekDate) ? ops(`/ops/v1/daily-performance?record_date=${priorWeekDate}`) : Promise.resolve({ data: [] }),
    ops(`/ops/v1/alerts?${range}`),
    ops(`/ops/v1/cash/status?${range}`)
  ]);
  let paymentState = { reservedAccounts: [], transactions: [], paymentsAvailable: false };
  try {
    const [reservedAccounts, transactions] = await Promise.all([
      payments("/payments/v1/reserved-accounts"),
      payments("/payments/v1/transactions")
    ]);
    paymentState = { reservedAccounts: reservedAccounts.data || [], transactions: transactions.data || [], paymentsAvailable: true };
  } catch {
    paymentState = { reservedAccounts: [], transactions: [], paymentsAvailable: false };
  }
  Object.assign(state, {
    people: people.data,
    amoebas: amoebas.data,
    operators: operators.data,
    economicsPolicies: economicsPolicies.data || [],
    allPerformance: allPerformance.data,
    board: board.data,
    availableDates,
    selectedDates,
    performance: dailyPerformance.data,
    priorPerformance: singleDay ? priorDayPerformance.data : rowsForDates(allPerformance.data, priorPeriodDates),
    priorWeekPerformance: singleDay ? sameWeekdayPerformance.data : rowsForDates(allPerformance.data, priorPeriodDates),
    alerts: alerts.data,
    cashStatus: cashStatus.data,
    reservedAccounts: paymentState.reservedAccounts,
    transactions: paymentState.transactions,
    paymentsAvailable: paymentState.paymentsAvailable,
    operatingDate
  });
  applyEconomicsPolicy();
  render();
  connection("connected", "Scoped APIs connected");
  el.notice.textContent = "Analytics view uses Net Earnings, scoped amoebas and derived control signals for local Phase 4E review.";
}

document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
el.exportAnalyticsCsv.addEventListener("click", exportAnalyticsCsv);
el.dateFrom.addEventListener("change", () => refresh().catch(showError));
el.dateTo.addEventListener("change", () => refresh().catch(showError));
document.addEventListener("click", (event) => {
  const periodButton = event.target.closest("[data-period-mode]");
  if (periodButton) {
    setPeriodMode(periodButton.dataset.periodMode);
    return;
  }
  const sortButton = event.target.closest("[data-sort-operators]");
  if (sortButton) {
    setOperatorSort(sortButton.dataset.sortOperators);
    return;
  }
  const leaderboardSortButton = event.target.closest("[data-sort-leaderboard]");
  if (leaderboardSortButton) {
    setLeaderboardSort(leaderboardSortButton.dataset.sortLeaderboard);
    return;
  }
  const target = event.target.closest("[data-detail-type]");
  if (!target) return;
  if (target.dataset.detailType === "amoeba") showAmoebaDetail(target.dataset.detailId);
  if (target.dataset.detailType === "operator") showOperatorDetail(target.dataset.detailId);
  if (target.dataset.detailType === "operator-group") showOperatorGroupDetail(target.dataset.detailId);
  if (target.dataset.detailType === "data-quality") showDataQualityDetail();
  if (target.dataset.detailType === "attention") showAttentionDetail(target.dataset.detailId);
  if (target.dataset.detailType === "leakage-group") showLeakageGroupDetail(target.dataset.detailId);
  if (target.dataset.detailType === "alert") showAlertDetail(target.dataset.detailId);
  if (target.dataset.detailType === "trend-day") showTrendDayDetail(target.dataset.detailId);
});
document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const target = event.target.closest("[data-detail-type]");
  if (!target) return;
  event.preventDefault();
  if (target.dataset.detailType === "amoeba") showAmoebaDetail(target.dataset.detailId);
  if (target.dataset.detailType === "operator") showOperatorDetail(target.dataset.detailId);
  if (target.dataset.detailType === "operator-group") showOperatorGroupDetail(target.dataset.detailId);
  if (target.dataset.detailType === "data-quality") showDataQualityDetail();
  if (target.dataset.detailType === "attention") showAttentionDetail(target.dataset.detailId);
  if (target.dataset.detailType === "leakage-group") showLeakageGroupDetail(target.dataset.detailId);
  if (target.dataset.detailType === "alert") showAlertDetail(target.dataset.detailId);
  if (target.dataset.detailType === "trend-day") showTrendDayDetail(target.dataset.detailId);
});
function showError(error) {
  connection("error", "API error");
  el.notice.textContent = error.message;
  el.notice.classList.add("error");
}
refresh().catch(showError);
