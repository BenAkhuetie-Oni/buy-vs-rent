// Buy vs Rent calculator — client-side for GitHub Pages
// Keeps curved chart styling, but now detects and displays ALL breakevens.

const $ = (id) => document.getElementById(id);

const fmtMoney0 = (n) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

let chartInstance = null;

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
  return errors;
}

function mortgagePayment(principal, annualRate, termMonths) {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return principal * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

function snapshotRow(year, { buyOOP, rentOOP, buyEquity, rentEquity }) {
  const buyNWI = buyEquity - buyOOP;
  const rentNWI = rentEquity - rentOOP;
  const diff = buyNWI - rentNWI;

  let better = "TIE";
  if (diff > 0) better = "BUY";
  if (diff < 0) better = "RENT";

  return { year, better, buyNWI, rentNWI, diff, buyEquity, buyOOP, rentEquity, rentOOP };
}

function runModel(inputs) {
  const { required: r, opt: oIn } = inputs;

  // Make a copy because we mutate monthly inflating utility/insurance
  const o = JSON.parse(JSON.stringify(oIn));

  const months = r.years * 12;
  const termMonths = o.termYears * 12;

  const downPayment = r.homePrice * r.downPct;
  const loanAmount = r.homePrice - downPayment;
  const pmt = mortgagePayment(loanAmount, r.mortgageRate, termMonths);

  const monthlyHomeApp = Math.pow(1 + o.homeAppreciation, 1 / 12) - 1;
  const monthlyRentInfl = Math.pow(1 + o.rentInflation, 1 / 12) - 1;
  const monthlyCostInfl = Math.pow(1 + o.costInflation, 1 / 12) - 1;
  const monthlyInv = Math.pow(1 + o.investReturn, 1 / 12) - 1;

  const rows = [];

  let homeValue = r.homePrice;
  let rent = r.monthlyRent;
  let loanBal = loanAmount;

  let buyOOP = 0;
  let rentOOP = 0;

  let buyEquityDown = downPayment;
  let buyEquityPrincipal = 0;
  let buyInvest = 0;
  let rentInvest = 0;

  const buyClosing = r.homePrice * o.buyClosePct;
  buyOOP += downPayment + buyClosing;

  rows.push(snapshotRow(0, {
    buyOOP,
    rentOOP,
    buyEquity: buyEquityDown + buyEquityPrincipal + (homeValue - r.homePrice) + buyInvest,
    rentEquity: rentInvest,
  }));

  for (let m = 1; m <= months; m++) {
    // Mortgage P&I
    let interest = 0;
    let principal = 0;
    if (loanBal > 0) {
      const rMonthly = r.mortgageRate / 12;
      interest = loanBal * rMonthly;
      principal = Math.min(pmt - interest, loanBal);
      loanBal = Math.max(0, loanBal - principal);
    }

    // PMI if <20% down AND LTV > 80%
    let pmi = 0;
    if (r.downPct < 0.20) {
      const ltv = loanBal / homeValue;
      if (ltv > 0.80 && loanBal > 0) {
        pmi = (loanAmount * o.pmiRate) / 12;
      }
    }

    // Other buy costs (scale w/ home value)
    const propTax = (homeValue * o.propTaxRate) / 12;
    const homeIns = (homeValue * o.homeInsRate) / 12;
    const maint = (homeValue * o.maintRate) / 12;
    const capex = (homeValue * o.capexRate) / 12;

    const buyMonthlyOOP = principal + interest + propTax + homeIns + pmi + maint + capex + o.utilBuy;
    buyOOP += buyMonthlyOOP;
    buyEquityPrincipal += principal;

    // Appreciation
    homeValue *= (1 + monthlyHomeApp);

    // Rent costs
    const rentMonthlyOOP = rent + o.rentersIns + o.utilRent;
    rentOOP += rentMonthlyOOP;

    // Inflate rent and “other costs”
    rent *= (1 + monthlyRentInfl);
    o.utilBuy *= (1 + monthlyCostInfl);
    o.utilRent *= (1 + monthlyCostInfl);
    o.rentersIns *= (1 + monthlyCostInfl);

    // Invest excess monthly cash (opportunity cost)
    buyInvest *= (1 + monthlyInv);
    rentInvest *= (1 + monthlyInv);

    const diff = rentMonthlyOOP - buyMonthlyOOP;
    if (diff > 0) buyInvest += diff;
    else if (diff < 0) rentInvest += (-diff);

    // Year snapshots
    if (m % 12 === 0) {
      const year = m / 12;

      // Sale closing costs only at the end of horizon (since you only sell at that point)
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

// Detect ALL breakeven points (diff crosses 0 between consecutive years)
function findBreakevens(rows) {
  const points = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].diff;
    const curr = rows[i].diff;

    if (prev === 0) points.push(rows[i - 1].year);

    if ((prev < 0 && curr > 0) || (prev > 0 && curr < 0)) {
      const y0 = rows[i - 1].year;
      const y1 = rows[i].year;
      const t = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr)); // linear interpolation
      points.push(y0 + t * (y1 - y0));
    }
  }
  return points;
}

function renderTable(rows) {
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
}

function renderSummary(rows) {
  const last = rows[rows.length - 1];
  const rec = last.better;
  const absDiff = Math.abs(last.diff);

  $("recPill").textContent = `Recommendation: ${rec}`;
  $("diffPill").textContent = `Final difference: ${fmtMoney0(absDiff)} (${rec} wins)`;

  $("resultTop").classList.remove("muted");
  $("resultTop").innerHTML = `
    Over <b>${last.year} years</b>, this tool estimates <b>${rec}</b> produces the higher Net Worth Impact.
    Net Worth Impact = <b>Equity − Out-of-pocket costs</b>.
  `;
}

function buildChart(rows) {
  const labels = rows.map(r => r.year);
  const buySeries = rows.map(r => Math.round(r.buyNWI));
  const rentSeries = rows.map(r => Math.round(r.rentNWI));

  const root = getComputedStyle(document.documentElement);
  const forest = root.getPropertyValue("--forest").trim();
  const sage = root.getPropertyValue("--sage").trim();
  const coral = root.getPropertyValue("--coral").trim();
  const muted = root.getPropertyValue("--muted2").trim();

  const ctx = $("nwiChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Buy (Net Worth Impact)",
          data: buySeries,
          borderColor: forest,
          backgroundColor: forest,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25, // KEEP curved design per your request
        },
        {
          label: "Rent (Net Worth Impact)",
          data: rentSeries,
          borderColor: sage,
          backgroundColor: sage,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25, // KEEP curved design per your request
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: muted, boxWidth: 14, boxHeight: 14 }
        },
        tooltip: {
          callbacks: {
            title: (items) => `Year ${items[0].label}`,
            label: (item) => `${item.dataset.label}: ${fmtMoney0(item.parsed.y)}`,
          }
        }
      },
      scales: {
        x: {
          ticks: { color: muted },
          grid: { color: "rgba(82,85,78,0.12)" }
        },
        y: {
          ticks: {
            color: muted,
            callback: (v) => fmtMoney0(v),
          },
          grid: { color: "rgba(82,85,78,0.12)" }
        }
      }
    }
  });

  // Breakeven display (ALL crossovers)
  const bes = findBreakevens(rows);

  if (!bes.length) {
    $("breakevenText").textContent = "Breakeven: no crossover";
    $("breakevenText").removeAttribute("style");
    return;
  }

  $("breakevenText").textContent =
    `Breakeven: ${bes.map(x => `~Year ${x.toFixed(1)}`).join(", ")}`;

  // Use coral sparingly: only highlight when breakevens exist
  $("breakevenText").style.borderColor = "rgba(231,84,60,0.35)";
  $("breakevenText").style.background = "rgba(231,84,60,0.08)";
  $("breakevenText").style.color = coral;
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
  ids.forEach(id => { const el = $(id); if (el) el.value = ""; });

  // restore optional defaults
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
  $("breakevenText").textContent = "Breakeven: —";
  $("breakevenText").removeAttribute("style");

  $("resultTop").classList.add("muted");
  $("resultTop").textContent = "Enter inputs and click Calculate.";

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
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

    renderSummary(rows);
    renderTable(rows);
    buildChart(rows);

    $("csvBtn").onclick = () => {
      const csv = rowsToCSV(rows);
      download("buy-vs-rent-results.csv", csv);
    };
  });

  $("resetBtn").addEventListener("click", resetAll);
}

main();
