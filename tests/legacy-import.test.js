import { describe, expect, it } from "vitest";
import LegacyImport from "../js/legacy-import.js";
import GSTIN from "../js/gstin.js";

const { printedSellerGstin, toRecord, GSTIN_HISTORY } = LegacyImport;

describe("printedSellerGstin", () => {
  it.each([
    ["odisha", "2026-08-01T10:00:00+05:30", "21AAKFF8134C1ZU"],
    ["wb", "2026-08-01T10:00:00+05:30", null], // office didn't exist yet
    ["odisha", "2026-09-01T10:00:00+05:30", "21AAKFF8134C1ZU"],
    ["wb", "2026-09-01T10:00:00+05:30", "19AAKFF8134C1ZU"],
    ["odisha", "2026-10-23T10:00:00+05:30", "21AAKFF8134C1ZF"], // the Chemstack window
    ["wb", "2026-10-23T10:00:00+05:30", "19AAKFF8134C1ZF"],
    ["odisha", "2026-10-26T10:00:00+05:30", "21AAKFF8134C1ZU"],
    ["wb", "2026-10-26T10:00:00+05:30", "19AAKFF8134C1ZF"],
  ])("%s at %s printed %s", (office, at, expected) => {
    expect(printedSellerGstin(office, at)).toBe(expected);
  });

  it("boundaries are exclusive of the change time", () => {
    expect(printedSellerGstin("odisha", "2026-09-12T18:06:53+05:30")).toBe("21AAKFF8134C1ZU");
    expect(printedSellerGstin("odisha", "2026-09-12T18:06:54+05:30")).toBe("21AAKFF8134C1ZF");
  });

  it("returns null without an office or a valid time", () => {
    expect(printedSellerGstin(null, "2026-09-01")).toBeNull();
    expect(printedSellerGstin("odisha", "not a date")).toBeNull();
  });

  it("current era matches the valid GSTINs", () => {
    const now = GSTIN_HISTORY[GSTIN_HISTORY.length - 1];
    expect(GSTIN.isValid(now.odisha)).toBe(true);
    expect(GSTIN.isValid(now.wb)).toBe(true);
  });
});

describe("toRecord", () => {
  const chemstack = {
    invNo: "FSH/032/26-27",
    customer: "CHEMSTACK PVT LTD",
    amount: 123003,
    date: "2026-10-22",
    type: "Tax Invoice",
    invType: "tax",
    savedAt: "2026-10-23T06:12:00.000Z",
    snapshot: { vals: { iCompany: "odisha", cGs: " 27aaaca1234b1z5 " } },
  };

  it("maps a tax invoice and reconstructs the printed GSTIN", () => {
    expect(toRecord(chemstack)).toEqual({
      inv_type: "tax",
      inv_no: "FSH/032/26-27",
      inv_date: "2026-10-22",
      office: "odisha",
      seller_gstin: "21AAKFF8134C1ZF",
      customer_name: "CHEMSTACK PVT LTD",
      customer_gstin: "27AAACA1234B1Z5",
      amount: 123003,
      snapshot: chemstack.snapshot,
      source: "import",
      issued_at: "2026-10-23T06:12:00.000Z",
    });
  });

  it("reads commission office and customer fields", () => {
    const r = toRecord({
      invNo: "FSH/C/01", type: "Commission Invoice", savedAt: "2026-10-01T00:00:00Z", amount: "500",
      snapshot: { vals: { cCompany: "wb", cToGstin: "19AANCM7741C1Z8" } },
    });
    expect(r).toMatchObject({ inv_type: "commission", office: "wb", seller_gstin: "19AAKFF8134C1ZF", customer_gstin: "19AANCM7741C1Z8", amount: 500 });
  });

  it("infers type from the label when invType is missing", () => {
    expect(toRecord({ invNo: "P1", type: "Proforma Invoice", savedAt: "2026-10-01T00:00:00Z" }).inv_type).toBe("proforma");
    expect(toRecord({ invNo: "T1", type: "Tax Invoice", savedAt: "2026-10-01T00:00:00Z" }).inv_type).toBe("tax");
  });

  it("assumes Odisha before WB existed, unknown after", () => {
    expect(toRecord({ invNo: "A", savedAt: "2026-08-01T00:00:00Z" })).toMatchObject({ office: "odisha", seller_gstin: "21AAKFF8134C1ZU" });
    expect(toRecord({ invNo: "B", savedAt: "2026-09-01T00:00:00Z" })).toMatchObject({ office: null, seller_gstin: null });
  });

  it("nulls bad amounts and dates", () => {
    expect(toRecord({ invNo: "X", savedAt: "2026-10-01T00:00:00Z", amount: "abc", date: "22/10/2026" })).toMatchObject({ amount: null, inv_date: null });
  });

  it.each([
    [{ savedAt: "2026-10-01T00:00:00Z" }],
    [{ invNo: "   ", savedAt: "2026-10-01T00:00:00Z" }],
    [{ invNo: "X" }],
    [{ invNo: "X", savedAt: "garbage" }],
  ])("rejects unusable entry %j", (e) => {
    expect(toRecord(e)).toBeNull();
  });
});
