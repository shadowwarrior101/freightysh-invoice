// Converts entries from the old localStorage "invoiceRegister" into
// invoice_records rows (source = 'import'). Pure: no DOM, no network, so it is
// unit-tested in tests/legacy-import.test.js.
(function (root) {
  // Seller GSTIN the app printed, by office, over time. Boundaries are the
  // commit times of the changes (deploys followed within minutes), so an
  // invoice generated right at a boundary may be on either side.
  const GSTIN_HISTORY = [
    // before fc96eb9: Odisha was the only office
    { until: "2026-08-23T15:54:25+05:30", odisha: "21AAKFF8134C1ZU", wb: null },
    // fc96eb9 added WB with the wrong check digit
    { until: "2026-09-12T18:06:54+05:30", odisha: "21AAKFF8134C1ZU", wb: "19AAKFF8134C1ZU" },
    // 2e0398a "fixed" both to 1ZF; correct for WB, wrong for Odisha
    { until: "2026-10-25T14:15:11+05:30", odisha: "21AAKFF8134C1ZF", wb: "19AAKFF8134C1ZF" },
    { until: null, odisha: "21AAKFF8134C1ZU", wb: "19AAKFF8134C1ZF" },
  ];

  function printedSellerGstin(office, issuedAt) {
    const t = new Date(issuedAt).getTime();
    if (!office || isNaN(t)) return null;
    const era = GSTIN_HISTORY.find((e) => e.until === null || t < new Date(e.until).getTime());
    return era[office] || null;
  }

  function invTypeOf(entry) {
    if (entry.invType) return entry.invType;
    const t = String(entry.type || "").toLowerCase();
    if (t.includes("commission")) return "commission";
    if (t.includes("proforma")) return "proforma";
    return "tax";
  }

  // Returns a row for insertion, or null if the entry can't be archived.
  function toRecord(entry) {
    const invNo = String(entry.invNo || "").trim();
    if (!invNo) return null;
    const invType = invTypeOf(entry);
    const vals = (entry.snapshot && entry.snapshot.vals) || {};
    const issuedAt = entry.savedAt && !isNaN(new Date(entry.savedAt)) ? new Date(entry.savedAt).toISOString() : null;
    if (!issuedAt) return null; // needed for de-duplication across re-imports

    let office = (invType === "commission" ? vals.cCompany : vals.iCompany) || null;
    // Before the second office existed every invoice was Odisha.
    if (!office && new Date(issuedAt) < new Date(GSTIN_HISTORY[0].until)) office = "odisha";

    const customerGstin = (invType === "commission" ? vals.cToGstin : vals.cGs) || null;
    const amount = Number(entry.amount);
    return {
      inv_type: invType,
      inv_no: invNo,
      inv_date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date || "") ? entry.date : null,
      office,
      seller_gstin: printedSellerGstin(office, issuedAt),
      customer_name: entry.customer || null,
      customer_gstin: customerGstin ? String(customerGstin).trim().toUpperCase() : null,
      amount: Number.isFinite(amount) ? amount : null,
      snapshot: entry.snapshot || null,
      source: "import",
      issued_at: issuedAt,
    };
  }

  const api = { GSTIN_HISTORY, printedSellerGstin, toRecord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LegacyImport = api;
})(this);
