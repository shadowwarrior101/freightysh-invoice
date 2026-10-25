// Supabase-backed invoice archive. Replaces the localStorage "invoiceRegister"
// as the source of truth: every generated PDF is uploaded and recorded here
// BEFORE it is handed to the user, so no invoice can exist without a record.
(function (root) {
  const cfg = root.FSH_CONFIG;
  const sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const BUCKET = "invoices";
  const LABEL = { tax: "Tax Invoice", proforma: "Proforma Invoice", commission: "Commission Invoice" };

  let cache = []; // latest version per invoice, newest first, in the legacy register shape
  let userEmail = null;

  function fail(prefix, error) {
    console.error(prefix, error);
    throw new Error(prefix + ": " + (error && error.message ? error.message : error));
  }

  // Map a DB row to the shape the existing register/dashboard code expects.
  function toEntry(r) {
    return {
      id: r.id,
      invNo: r.inv_no,
      invType: r.inv_type,
      type: LABEL[r.inv_type] || r.inv_type,
      customer: r.customer_name,
      amount: r.amount == null ? null : Number(r.amount),
      date: r.inv_date,
      savedAt: r.issued_at,
      snapshot: r.snapshot,
      office: r.office,
      sellerGstin: r.seller_gstin,
      customerGstin: r.customer_gstin,
      pdfPath: r.pdf_path,
      source: r.source,
    };
  }

  async function refresh() {
    // PostgREST caps responses at 1000 rows; page through to get them all.
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("invoices_current").select("*")
        .order("issued_at", { ascending: false }).range(from, from + 999);
      if (error) fail("Could not load invoice register", error);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    cache = rows.map(toEntry);
    return cache;
  }

  // Resolves with the user's email once signed in as freightysh_ops, or null
  // if there is no usable session (caller shows the login screen).
  async function session() {
    const { data } = await sb.auth.getSession();
    const user = data.session && data.session.user;
    if (!user) return null;
    const { data: role, error } = await sb.rpc("get_my_role");
    if (error) fail("Could not check your access", error);
    if (role !== "freightysh_ops") {
      await sb.auth.signOut();
      throw new Error(user.email + " is not allowed to use the invoice app");
    }
    userEmail = user.email;
    return userEmail;
  }

  async function sendLoginLink(email) {
    const { error } = await sb.auth.signInWithOtp({
      email: String(email).trim(),
      // Only existing accounts; this app must never create users.
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) fail("Could not send login link", error);
  }

  async function signOut() {
    await sb.auth.signOut();
    location.reload();
  }

  // Uploads the PDF and inserts the record. Throws on any failure; the caller
  // must not give the PDF to the user unless this resolves.
  async function archive(rec, pdfBlob) {
    const sellerProblem = root.GSTIN.problem(rec.sellerGstin);
    if (sellerProblem) throw new Error("Seller " + sellerProblem + " (" + rec.sellerGstin + ")");
    // Placeholders like "URP" / "N/A" (unregistered or overseas customers)
    // contain no digits; anything with a digit is treated as a real GSTIN.
    if (/\d/.test(rec.customerGstin || "")) {
      const custProblem = root.GSTIN.problem(rec.customerGstin);
      if (custProblem) throw new Error("Customer " + custProblem + " (" + rec.customerGstin + ")");
    }

    const safeNo = rec.invNo.replace(/[^A-Za-z0-9-]+/g, "-");
    const path = rec.invType + "/" + safeNo + "/" + new Date().toISOString().replace(/[:.]/g, "-") + ".pdf";
    const up = await sb.storage.from(BUCKET).upload(path, pdfBlob, { contentType: "application/pdf", upsert: false });
    if (up.error) fail("Could not save PDF to archive", up.error);

    const { data, error } = await sb.from("invoice_records").insert({
      inv_type: rec.invType,
      inv_no: rec.invNo,
      inv_date: rec.invDate || null,
      office: rec.office,
      seller_gstin: root.GSTIN.normalize(rec.sellerGstin),
      customer_name: rec.customerName || null,
      customer_gstin: rec.customerGstin ? root.GSTIN.normalize(rec.customerGstin) : null,
      amount: rec.amount,
      snapshot: rec.snapshot,
      pdf_path: path,
    }).select().single();
    // The orphaned PDF can't be deleted (no delete policy, by design); it's
    // harmless and the user simply retries.
    if (error) fail("Could not save invoice record", error);

    const entry = toEntry(data);
    cache = [entry, ...cache.filter((e) => !(e.invType === entry.invType && e.invNo.trim().toUpperCase() === entry.invNo.trim().toUpperCase()))];
    return entry;
  }

  async function pdfUrl(path) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) fail("Could not open archived PDF", error);
    return data.signedUrl;
  }

  // One-time backfill of this browser's old localStorage register. Safe to
  // re-run: already-imported entries hit a unique index and are skipped.
  async function importLocalRegister() {
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem("invoiceRegister")) || []; } catch (e) { legacy = []; }
    let imported = 0, skipped = 0, invalid = 0;
    for (const entry of legacy) {
      const row = root.LegacyImport.toRecord(entry);
      if (!row) { invalid++; continue; }
      const { error } = await sb.from("invoice_records").insert(row);
      if (!error) imported++;
      else if (error.code === "23505") skipped++;
      else fail("Import stopped at " + row.inv_no, error);
    }
    await refresh();
    return { total: legacy.length, imported, skipped, invalid };
  }

  root.InvoiceStore = {
    session, sendLoginLink, signOut, refresh, archive, pdfUrl, importLocalRegister,
    register: () => cache,
    email: () => userEmail,
  };
})(this);
