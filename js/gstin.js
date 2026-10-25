// GSTIN validation (format + check digit). Loaded as a plain <script> in the
// browser (exposes window.GSTIN) and required by the unit tests in Node.
(function (root) {
  const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // 2-digit state code, 10-char PAN, entity number, 'Z', check character
  const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

  // GSTN check digit: base-36 Luhn-style over the first 14 characters,
  // alternating weights 1,2 from the left.
  function checkChar(first14) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const v = CHARSET.indexOf(first14[i]);
      if (v < 0) return null;
      const p = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return CHARSET[(36 - (sum % 36)) % 36];
  }

  function normalize(gstin) {
    return String(gstin == null ? "" : gstin).trim().toUpperCase();
  }

  // Returns null when valid, otherwise a human-readable reason.
  function problem(gstin) {
    const g = normalize(gstin);
    if (!g) return "GSTIN is empty";
    if (g.length !== 15) return "GSTIN must be 15 characters (got " + g.length + ")";
    if (!FORMAT.test(g)) return "GSTIN format is invalid";
    const expected = checkChar(g.slice(0, 14));
    if (g[14] !== expected) return "GSTIN check digit is wrong (last character should be " + expected + ")";
    return null;
  }

  const api = {
    checkChar,
    normalize,
    problem,
    isValid: (gstin) => problem(gstin) === null,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GSTIN = api;
})(this);
