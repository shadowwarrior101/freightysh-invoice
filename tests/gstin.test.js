import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import GSTIN from "../js/gstin.js";

describe("GSTIN check digit", () => {
  it.each([
    ["21AAKFF8134C1ZU", true], // Freightysh, Odisha
    ["19AAKFF8134C1ZF", true], // Freightysh, West Bengal
    ["21AAKFF8134C1ZF", false], // printed on Odisha invoices 12 Sep - 25 Oct 2026
    ["19AAKFF8134C1ZU", false], // printed on WB invoices 23 Aug - 12 Sep 2026
  ])("%s valid=%s", (g, ok) => {
    expect(GSTIN.isValid(g)).toBe(ok);
  });

  it("names the expected check character", () => {
    expect(GSTIN.problem("21AAKFF8134C1ZF")).toMatch(/should be U/);
  });

  it("normalizes case and whitespace", () => {
    expect(GSTIN.isValid("  21aakff8134c1zu ")).toBe(true);
  });

  it.each(["", null, "21AAKFF8134C1Z", "21AAKFF8134C1ZUX", "2AAAKFF8134C1ZU", "21AAKFF8134C1XU", "21AAKF-8134C1ZU"])(
    "rejects malformed %s",
    (g) => {
      expect(GSTIN.isValid(g)).toBe(false);
    },
  );
});

// Guards against the Sep 2026 regression: a GSTIN edited in one place but not
// the others, or "fixed" to a value that fails the checksum.
describe("index.html company GSTINs", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const block = html.match(/const COMPANY_PROFILES=\{([\s\S]*?)\n\};/);
  const profiles = [...block[1].matchAll(/(\w+):\{[^}]*gstin:"(\w+)",pan:"(\w+)",stateCode:"(\d+)"/g)].map(
    ([, key, gstin, pan, stateCode]) => ({ key, gstin, pan, stateCode }),
  );

  it("defines both offices", () => {
    expect(profiles.map((p) => p.key).sort()).toEqual(["odisha", "wb"]);
  });

  it.each(profiles.map((p) => [p.key, p]))("%s profile is internally consistent", (_, p) => {
    expect(GSTIN.problem(p.gstin)).toBeNull();
    expect(p.gstin.slice(0, 2)).toBe(p.stateCode);
    expect(p.gstin.slice(2, 12)).toBe(p.pan);
  });

  it("every Freightysh GSTIN hardcoded in the page matches a profile", () => {
    const known = new Set(profiles.map((p) => p.gstin));
    const found = [...html.matchAll(/\d{2}AAKFF8134C\w{3}/g)].map((m) => m[0]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((g) => !known.has(g))).toEqual([]);
  });
});
