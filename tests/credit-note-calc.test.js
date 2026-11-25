import { describe, expect, it } from "vitest";
import CN from "../js/credit-note-calc.js";

// Shape of a real FSH/040/26-27 snapshot (WB, CGST+SGST).
const taxInvoice = {
  invType: "tax",
  amount: 60890,
  snapshot: {
    vals: { iUr: "95.87", iTaxType: "cgst_sgst", cNm: "MICBAC INDIA (OPC) PRIVATE LIMITED", cAd: "KOLKATA", cSt: "WEST BENGAL", cSc: "19", cGs: "19AANCM7741C1Z8" },
    rows: [
      { desc: "OCEAN FREIGHT", sac: "996521", cur: "USD", rate: 400, qty: 1, igst: 5 },
      { desc: "LTHC", sac: "996759", cur: "INR", rate: 6520, qty: 1, igst: 18 },
      { desc: "SEAL CHARGES", sac: "996759", cur: "USD", rate: 10, qty: 1, igst: 18 },
    ],
  },
};

describe("originalLines", () => {
  it("converts foreign-currency rows at the invoice's rate", () => {
    expect(CN.originalLines(taxInvoice)).toEqual([
      { desc: "OCEAN FREIGHT", sac: "996521", gst: 5, taxable: 38348 },
      { desc: "LTHC", sac: "996759", gst: 18, taxable: 6520 },
      { desc: "SEAL CHARGES", sac: "996759", gst: 18, taxable: 958.7 },
    ]);
  });

  it("uses the commission USD rate when saved", () => {
    const e = { invType: "commission", amount: 2218, snapshot: { vals: { cUsdRate: "94" }, commRows: [{ usd: 20 }] } };
    expect(CN.originalLines(e)).toEqual([{ desc: "COMMISSION", sac: "998599", gst: 18, taxable: 1880 }]);
  });

  it("backs taxable out of the total for old commission snapshots", () => {
    const e = { invType: "commission", amount: 2218, snapshot: { vals: {}, commRows: [{ usd: 20 }] } };
    expect(CN.originalLines(e)[0].taxable).toBe(1879.66);
  });
});

describe("taxType and party", () => {
  it("reads tax invoice fields", () => {
    expect(CN.taxType(taxInvoice)).toBe("cgst_sgst");
    expect(CN.party(taxInvoice)).toMatchObject({ name: "MICBAC INDIA (OPC) PRIVATE LIMITED", stateCode: "19", gstin: "19AANCM7741C1Z8" });
  });

  it("reads commission fields and defaults to IGST", () => {
    const e = { invType: "commission", snapshot: { vals: { cToName: "CK", cToGstin: "19AAAAA0000A1Z5" } } };
    expect(CN.taxType(e)).toBe("igst");
    expect(CN.party(e)).toMatchObject({ name: "CK", gstin: "19AAAAA0000A1Z5" });
  });
});

describe("totals", () => {
  const lines = CN.originalLines(taxInvoice).map((l) => ({ ...l, credit: 0 }));

  it("splits CGST/SGST and skips zero lines", () => {
    lines[1].credit = 1000; // 18%
    lines[0].credit = 100.5; // 5%
    const t = CN.totals(lines, "cgst_sgst");
    expect(t.lines).toHaveLength(2);
    expect(t.taxable).toBe(1100.5);
    expect(t.tax).toBe(185.03); // 5.03 + 180
    expect(t.cgst + t.sgst).toBeCloseTo(t.tax, 2);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(1286);
    expect(t.roundOff).toBe(0.47);
  });

  it("puts everything in IGST for inter-state", () => {
    const t = CN.totals([{ desc: "X", sac: "1", gst: 18, taxable: 500, credit: 500 }], "igst");
    expect(t).toMatchObject({ igst: 90, cgst: 0, sgst: 0, total: 590 });
  });
});

describe("problem", () => {
  const base = [
    { desc: "A", taxable: 1000, credit: 0 },
    { desc: "B", taxable: 500, credit: 0 },
  ];
  const withCredit = (a, b) => [{ ...base[0], credit: a }, { ...base[1], credit: b }];

  it("accepts a partial credit", () => expect(CN.problem(withCredit(200, 0), 0)).toBeNull());
  it("accepts a full credit", () => expect(CN.problem(withCredit(1000, 500), 0)).toBeNull());
  it("rejects nothing to credit", () => expect(CN.problem(withCredit(0, 0), 0)).toMatch(/at least one line/));
  it("rejects more than the line", () => expect(CN.problem(withCredit(1000.5, 0), 0)).toMatch(/A: credit can't exceed/));
  it("rejects negatives and NaN", () => {
    expect(CN.problem(withCredit(-1, 0), 0)).toMatch(/valid amount/);
    expect(CN.problem(withCredit(NaN, 0), 0)).toMatch(/valid amount/);
  });
  it("rejects crediting beyond what earlier notes left", () => {
    expect(CN.problem(withCredit(600, 0), 1000)).toMatch(/Only 500.00/);
    expect(CN.problem(withCredit(500, 0), 1000)).toBeNull();
  });
});
