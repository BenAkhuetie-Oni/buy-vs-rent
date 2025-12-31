// Buy vs Rent calculator — runs fully client-side for GitHub Pages

const $ = (id) => document.getElementById(id);

const fmtMoney0 = (n) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtPct = (n) => `${(n * 100).toFixed(2)}%`;

function clampNumber(x, min, max) {
  if (!Number.isFinite(x)) return NaN;
  return Math.min(max, Math.max(min, x));
}

function parseInputs() {
  const required = {
    homePrice: Number($("homePrice").value),
    monthlyRent: Number($("monthlyRent").value),
    mortgageRate: Number($("mortgageRate").value) / 100,
    downPct: Number($("downPct").value) / 100,
    years: Math.floor(Number($("years").value)),
  };

  const opt = {
    termYears: Math.floor(Number($("termYears").value)),
    homeAppreciation: Number($("homeAppreciation").value) / 100,
    rentInflation: Number($("rentInflation").value) / 100,
    costInflation: Number($("costInflation").value) / 100,
    investReturn: Number($("investReturn").value) / 100,

    propTaxRate: Number($("propTaxRate").value) / 100,
    homeInsRate: Number($("homeInsRate").value) / 100,
    pmiRate: Number($("pmiRate").value) / 100,

    buyClosePct: Number($("buyClosePct").value) / 100,
    sellClosePct: Number($("sellClosePct").value) / 100,

    maintRate: Number($("maintRate").value) / 100,
    capexRate: Number($("capexRate").value) / 100,

    utilBuy: Number($("utilBuy").value),
    utilRent: Number($("utilRent").value),
    rentersIns: Number($("rentersIns").value),
  };

  return { required, opt };
}

function validate({ required, opt }) {
  const errors = [];

  if (!(required.homePrice > 0)) errors.push("Home price must be > 0.");
  if (!(required.monthlyRent >= 0)) errors.push("Monthly rent must be ≥ 0.");
  if (!(required.mortgageRate >= 0)) errors.push("Mortgage rate must be ≥ 0.");
  if (!(required.downPct >= 0 && required.downPct <= 1)) errors.push("Down payment % must be between 0 and 100.");
  if (!(required.years >= 1 && required.years <= 50)) errors.push("Years lived must be between 1 and 50.");

  if (!(opt.termYears >= 5 && opt.termYears <= 40)) errors.push("Mortgage term must be between 5 and 40 years.");

  // basic sanity (not strict)
  if (!(opt.propTaxRate >= 0 && opt.propTaxRate <= 0.2)) errors.push("Property tax rate looks invalid.");
  if (!(opt.sellClosePct >= 0 && opt.sellClosePct <= 0.25)) errors.push("Sale closing % looks invalid.");

  return errors;
}

/**
 * Monthly mortgage payment for fully amortizing loan
 */
function mortgagePayment(principal, annualRate, termMonths) {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return principal * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

/**
 * Simulates month-by-month cash flows for N years, then returns year-by-year snapshots (including year 0).
 *
 * Your definition:
 *  - Out-of-pocket includes: principal, interest, taxes, insurance, PMI, closing costs, maintenance, capex, utilities
 *  - Equity includes: down payment (initial equity), principal paid, appreciation, invested savings (excess cash)
 *  - Net Worth Impact = Equity - Out-of-pocket
 */
function runModel(inputs) {
  const { required: r, opt: o } = inputs;

  const months = r.years * 12;
  const termMonths = o.termYears * 12;

  const downPayment = r.homePrice * r.downPct;
  const loanAmount = r.homePrice - downPayment;

  const pmt = mortgagePayment(loanAmount, r.mortgageRate, termMonths);

  const monthlyHomeApp = Math.pow(1 + o.homeAppreciation, 1 / 12) - 1;
  const monthlyRentInfl = Math.pow(1 + o.rentInflation, 1 / 12) - 1;
  const monthlyCostInfl = Math.pow(1 + o.costInflation, 1 / 12) - 1;
  const monthlyInv = Math.pow(1 + o.investReturn, 1 / 12) - 1;

  // Year-by-year output, include year 0
  const rows = [];

  // Running totals
  let homeValue = r.homePrice;
  let rent = r.monthlyRent;

  let loanBal = loanAmount;

  let buyOOP = 0;
  let rentOOP = 0;

  // Equity components (as YOU described)
  let buyEquityDown = downPayment;        // initial equity
  let buyEquityPrincipal = 0;             // principal paid over time
  let buyEquityAppreciation = 0;          // home value change vs purchase
  let buyInvest = 0;                      // invested excess cash if buying cheaper

  let rentInvest = 0;                     // invested excess cash if renting cheaper

  // Closing costs out-of-pocket
  const buyClosing = r.homePrice * o.buyClosePct;
  buyOOP += downPayment + buyClosing; // down payment is an out-of-pocket cash outlay by definition
  // NOTE: Down payment is also counted in equity (buyEquityDown) so it cancels appropriately in NWI.

  // Year 0 row
  rows.push(snapshotRow(0, {
    buyOOP, rentOOP,
    buyEquity: buyEquityDown + buyEquityPrincipal + (homeValue - r.homePrice) + buyInvest,
    rentEquity: rentInvest,
  }));

  for (let m = 1; m <= months; m++) {
    // ----- Buying monthly costs -----
    // Interest/principal (if loan still active)
    let interest = 0;
    let principal = 0;

    if (loanBal > 0) {
      const rMonthly = r.mortgageRate / 12;
      interest = loanBal * rMonthly;
      principal = Math.min(pmt - interest, loanBal);
      loanBal = Math.max(0, loanBal - principal);
    }

    // PMI: if down < 20% AND LTV > 80%
    let pmi = 0;
    if (r.downPct < 0.20) {
      const ltv = loanBal / homeValue;
      if (ltv > 0.80 && loanBal > 0) {
        pmi = (loanAmount * o.pmiRate) / 12;
      }
    }

    // Costs that inflate with "other costs inflation"
    const propTax = (homeValue * o.propTaxRate) / 12;
    const homeIns = (homeValue * o.homeInsRate) / 12;
    const maint = (homeValue * o.maintRate) / 12;
    const capex = (homeValue * o.capexRate) / 12;
    const utilBuy = o.utilBuy;

    const buyMonthlyOOP = principal + interest + propTax + homeIns + pmi + maint + capex + utilBuy;

    buyOOP += buyMonthlyOOP;
    buyEquityPrincipal += principal; // loan paydown component

    // Home appreciation
    homeValue *= (1 + monthlyHomeApp);
    buyEquityAppreciation = homeValue - r.homePrice;

    // ----- Renting monthly costs -----
    const rentersIns = o.rentersIns;
    const utilRent = o.utilRent;

    const rentMonthlyOOP = rent + rentersIns + utilRent;
    rentOOP += rentMonthlyOOP;

    // Monthly inflation updates (rent + other costs)
    rent *= (1 + monthlyRentInfl);
    // Note: homeValue already adjusted above; costs derived from homeValue auto-scale.
    // Utilities and renters insurance inflate with "other costs inflation" to match your assumption set.
    o.utilBuy *= (1 + monthlyCostInfl);
    o.utilRent *= (1 + monthlyCostInfl);
    o.rentersIns *= (1 + monthlyCostInfl);

    // ----- Invest excess cash (opportunity cost) -----
    // If buying is cheaper this month, invest the difference in buy scenario
    const diff = rentMonthlyOOP - buyMonthlyOOP;

    // Grow both investment accounts
    buyInvest *= (1 + monthlyInv);
    rentInvest *= (1 + monthlyInv);

    if (diff > 0) {
      buyInvest += diff;
    } else if (diff < 0) {
      rentInvest += (-diff);
    }

    // End of year snapshot
    if (m % 12 === 0) {
      const year = m / 12;

      // Sale closing costs are treated as out-of-pocket at the END of the horizon
      // (since you listed "sale closing costs" under OOP)
      let buyOOPAdj = buyOOP;
      if (m === months) {
        const sellClosing = homeValue * o.sellClosePct;
        buyOOPAdj += sellClosing;
      }

      rows.push(snapshotRow(year, {
        buyOOP: buyOOPAdj,
        rentOOP,
        buyEquity: buyEquityDown + buyEquityPrincipal + (homeValue - r.homePrice) + buyInvest,
        rentEquity: rentInvest,
      }));
    }
  }

  return rows;
}

function snapshotRow(year, { buyOOP, rentOOP, buyEquity, rentEquity }) {
  const buyNWI = buyEquity - buyOOP;
  const rentNWI = rentEquity - rentOOP;
  const diff = buyNWI - rentNWI;

  let better = "TIE";
  if (diff > 0) better = "BUY";
  if (diff < 0) better = "RENT";

  return {
    year,
    better,
    buyNWI,
    rentNWI,
    diff,
    buyEquity,
    buyOOP,
    rentEquity,
    rentOOP,
  };
}

function render(rows) {
  const body = $("resultsBody");
  body.innerHTML = "";

  rows.forEach((r) => {
    const tr = document.createElement("tr");

    const cells = [
      r.year.toString(),
      r.better,
      fmtMoney0(r.buyNWI),
      fmtMoney0(r.rentNWI),
      fmtMoney0(r.diff),
      fmtMoney0(r.buyEquity),
      fmtMoney0(r.buyOOP),
      fmtMoney0(r.rentEquity),
      fmtMoney0(r.rentOOP),
    ];

    cells.forEach((c, idx) => {
      const td = document.createElement("td");
      td.textContent = c;
      if (idx === 0 || idx === 1) td.style.textAlign = "left";
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  $("resultsTable").classList.remove("hidden");
  $("csvBtn").disabled = false;

  // Summary
  const last = rows[rows.length - 1];
  const rec = last.better;
  const absDiff = Math.abs(last.diff);

  $("recPill").textContent = `Recommendation: ${rec}`;
  $("diffPill").textContent = `Final difference: ${fmtMoney0(absDiff)} (${rec} wins)`;

  $("resultTop").classList.remove("muted");
  $("resultTop").innerHTML = `
    Over <b>${last.year} years</b>, this tool estimates <b>${rec}</b> produces the higher Net Worth Impact.
    Net Worth Impact is calculated as <b>Equity − Out-of-pocket costs</b>.
    “Equity” includes home appreciation and invested monthly savings (opportunity cost).
  `;
}

function rowsToCSV(rows) {
  const header = ["Year","Better","Buy_NWI","Rent_NWI","Diff_BuyMinusRent","Buy_Equity","Buy_OOP","Rent_Equity","Rent_OOP"];
  const lines = [header.join(",")];

  rows.forEach(r => {
    lines.push([
      r.year,
      r.better,
      Math.round(r.buyNWI),
      Math.round(r.rentNWI),
      Math.round(r.diff),
      Math.round(r.buyEquity),
      Math.round(r.buyOOP),
      Math.round(r.rentEquity),
      Math.round(r.rentOOP),
    ].join(","));
  });

  return lines.join("\n");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setDefaultsIfEmpty() {
  const defaults = {
    homePrice: 450000,
    monthlyRent: 2600,
    mortgageRate: 6.75,
    downPct: 10,
    years: 10,
  };

  for (const [k, v] of Object.entries(defaults)) {
    const el = $(k);
    if (el && (el.value === "" || el.value == null)) el.value = v;
  }
}

function resetAll() {
  const ids = [
    "homePrice","monthlyRent","mortgageRate","downPct","years",
    "termYears","homeAppreciation","rentInflation","costInflation","investReturn",
    "propTaxRate","homeInsRate","pmiRate","buyClosePct","sellClosePct",
    "maintRate","capexRate","utilBuy","utilRent","rentersIns"
  ];
  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.value = "";
  });

  // Restore optional defaults
  $("termYears").value = 30;
  $("homeAppreciation").value = 3.0;
  $("rentInflation").value = 3.0;
  $("costInflation").value = 3.0;
  $("investReturn").value = 7.0;
  $("propTaxRate").value = 1.10;
  $("homeInsRate").value = 0.35;
  $("pmiRate").value = 0.70;
  $("buyClosePct").value = 3.0;
  $("sellClosePct").value = 6.0;
  $("maintRate").value = 1.00;
  $("capexRate").value = 0.50;
  $("utilBuy").value = 250;
  $("utilRent").value = 250;
  $("rentersIns").value = 15;

  $("resultsBody").innerHTML = "";
  $("resultsTable").classList.add("hidden");
  $("csvBtn").disabled = true;
  $("recPill").textContent = "—";
  $("diffPill").textContent = "—";
  $("resultTop").classList.add("muted");
  $("resultTop").textContent = "Enter inputs and click Calculate.";
}

function main() {
  $("yearNow").textContent = new Date().getFullYear();

  $("calcBtn").addEventListener("click", () => {
    setDefaultsIfEmpty();

    const inputs = parseInputs();
    const errors = validate(inputs);

    if (errors.length) {
      $("resultTop").classList.remove("muted");
      $("resultTop").innerHTML = `<b>Fix these:</b><br>${errors.map(e => `• ${e}`).join("<br>")}`;
      $("resultsTable").classList.add("hidden");
      $("csvBtn").disabled = true;
      return;
    }

    const rows = runModel(inputs);
    render(rows);

    $("csvBtn").onclick = () => {
      const csv = rowsToCSV(rows);
      download("buy-vs-rent-results.csv", csv);
    };
  });

  $("resetBtn").addEventListener("click", resetAll);
}

main();
