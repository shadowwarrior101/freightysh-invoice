// Credit note figures, derived from the original invoice's saved snapshot.
// Pure: no DOM, no network, so it is unit-tested in tests/credit-note-calc.test.js.
(function (root) {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const COMMISSION_SAC = "998599";

  // Taxable value per line of the original invoice, computed the same way the
  // invoice PDF does (calc() / commTotals() in index.html).
  function originalLines(entry) {
    const snap = entry.snapshot || {};
    const vals = snap.vals || {};
    if (entry.invType === "commission") {
      const usdRate = parseFloat(vals.cUsdRate);
      const usd = (snap.commRows || []).reduce((s, r) => s + (parseFloat(r.usd) || 0), 0);
      // Commission snapshots before Nov 2026 didn't save the USD rate; the
      // stored total is round(taxable * 1.18), so back it out from that.
      const taxable = usdRate > 0 ? round2(usd * usdRate) : round2(Number(entry.amount || 0) / 1.18);
      return [{ desc: "COMMISSION", sac: COMMISSION_SAC, gst: 18, taxable }];
    }
    const fx = parseFloat(vals.iUr) || 94.29;
    return (snap.rows || []).map((r) => ({
      desc: r.desc || "",
      sac: r.sac || "",
      gst: Number(r.igst) || 0,
      taxable: round2((Number(r.rate) || 0) * (Number(r.qty) || 0) * (r.cur === "INR" ? 1 : fx)),
    }));
  }

  function taxType(entry) {
    const vals = (entry.snapshot && entry.snapshot.vals) || {};
    return (entry.invType === "commission" ? vals.cTaxType : vals.iTaxType) || "igst";
  }

  function party(entry) {
    const v = (entry.snapshot && entry.snapshot.vals) || {};
    const c = entry.invType === "commission";
    return {
      name: (c ? v.cToName : v.cNm) || entry.customer || "",
      address: (c ? v.cToAddr : v.cAd) || "",
      state: (c ? v.cToState : v.cSt) || "",
      stateCode: (c ? v.cToStateCode : v.cSc) || "",
      gstin: (c ? v.cToGstin : v.cGs) || entry.customerGstin || "",
    };
  }

  // lines: [{desc, sac, gst, taxable, credit}]; credit = taxable value credited.
  function totals(lines, type) {
    const out = lines.filter((l) => l.credit > 0).map((l) => {
      const tax = round2((l.credit * l.gst) / 100);
      const cgst = type === "cgst_sgst" ? round2(tax / 2) : 0;
      return { ...l, tax, cgst, sgst: type === "cgst_sgst" ? round2(tax - cgst) : 0, igst: type === "cgst_sgst" ? 0 : tax };
    });
    const taxable = round2(out.reduce((s, l) => s + l.credit, 0));
    const tax = round2(out.reduce((s, l) => s + l.tax, 0));
    const raw = round2(taxable + tax);
    const total = Math.round(raw);
    return {
      lines: out,
      taxable,
      cgst: round2(out.reduce((s, l) => s + l.cgst, 0)),
      sgst: round2(out.reduce((s, l) => s + l.sgst, 0)),
      igst: round2(out.reduce((s, l) => s + l.igst, 0)),
      tax,
      roundOff: round2(total - raw),
      total,
    };
  }

  // Returns null when OK, else a message. alreadyCredited = taxable value of
  // earlier credit notes against the same invoice.
  function problem(lines, alreadyCredited) {
    for (const l of lines) {
      if (!(l.credit >= 0)) return "Enter a valid amount for " + (l.desc || "each line");
      if (l.credit > l.taxable + 0.005) return (l.desc || "A line") + ": credit can't exceed its taxable value " + l.taxable.toFixed(2);
    }
    const sum = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (sum <= 0) return "Enter the amount to credit on at least one line";
    const invoiceTaxable = round2(lines.reduce((s, l) => s + l.taxable, 0));
    const left = round2(invoiceTaxable - (alreadyCredited || 0));
    if (sum > left + 0.005) return "Only " + left.toFixed(2) + " of this invoice's taxable value is left to credit";
    return null;
  }

  const api = { originalLines, taxType, party, totals, problem, round2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CreditNoteCalc = api;
})(this);
