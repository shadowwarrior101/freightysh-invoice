// Credit note against an issued tax/commission invoice: modal, PDF, archive.
// Figures come from CreditNoteCalc (unit-tested); this file is DOM + jsPDF glue.
// Relies on index.html globals: el, toast, COMPANY_PROFILES, InvoiceStore,
// renderRegister, renderDashboard, n2w, LOGO, SIG.
(function (root) {
  const REASONS = ["Post-sale discount", "Deficiency in services", "Correction in invoice", "Change in rate", "Other"];
  let state = null; // { entry, lines, type, party, already }

  const money = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const today = () => localDate();

  // Taxable value already credited against this invoice by earlier notes.
  function alreadyCredited(entry) {
    return root.InvoiceStore.register()
      .filter((r) => r.invType === "credit_note" && !r.cancelledAt && r.snapshot && r.snapshot.ref
        && r.snapshot.ref.invNo.toUpperCase() === entry.invNo.toUpperCase())
      .reduce((s, r) => s + (Number(r.snapshot.totals && r.snapshot.totals.taxable) || 0), 0);
  }

  function open(entry) {
    const CN = root.CreditNoteCalc;
    state = {
      entry,
      lines: CN.originalLines(entry).map((l) => ({ ...l, credit: 0 })),
      type: CN.taxType(entry),
      party: CN.party(entry),
      already: alreadyCredited(entry),
    };
    el("cnTitle").textContent = "Credit note against " + entry.invNo;
    el("cnMeta").textContent = state.party.name + " · invoice dated " + (entry.date || "—")
      + " · " + (state.type === "cgst_sgst" ? "CGST + SGST" : "IGST")
      + (state.already ? " · already credited " + money(state.already) + " taxable" : "");
    el("cnDate").value = today();
    el("cnReason").innerHTML = REASONS.map((r) => "<option>" + r + "</option>").join("");
    el("cnNote").value = "";
    el("cnLines").innerHTML = state.lines.map((l, i) =>
      "<tr><td>" + esc(l.desc) + "</td><td class=\"mono\">" + esc(l.sac) + "</td><td class=\"mono\" style=\"text-align:right\">"
      + money(l.taxable) + "</td><td class=\"mono\" style=\"text-align:right\">" + l.gst + "%</td>"
      + "<td><input class=\"mono\" type=\"number\" min=\"0\" step=\"0.01\" value=\"0\" style=\"width:110px\" oninput=\"CreditNote.setCredit(" + i + ",this.value)\"/></td></tr>").join("");
    update();
    el("cnModal").classList.add("on");
  }

  function setCredit(i, v) {
    state.lines[i].credit = v === "" ? 0 : Number(v);
    update();
  }

  function creditAll() {
    const inputs = el("cnLines").querySelectorAll("input");
    state.lines.forEach((l, i) => { l.credit = l.taxable; inputs[i].value = l.taxable; });
    update();
  }

  function update() {
    const CN = root.CreditNoteCalc;
    const t = CN.totals(state.lines, state.type);
    const taxCells = state.type === "cgst_sgst"
      ? "CGST " + money(t.cgst) + " · SGST " + money(t.sgst)
      : "IGST " + money(t.igst);
    el("cnTotals").textContent = "Taxable " + money(t.taxable) + " · " + taxCells + " · Total INR " + money(t.total);
    const p = CN.problem(state.lines, state.already);
    el("cnError").textContent = p && t.taxable > 0 ? p : "";
    el("cnGenBtn").disabled = !!p;
  }

  function close() {
    el("cnModal").classList.remove("on");
    state = null;
  }

  function buildPDF(no, date, reason, t) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const e = state.entry, P = state.party, CO = COMPANY_PROFILES[e.office];
    const NAVY = [10, 36, 99], ORANGE = [232, 99, 26], INK = [24, 28, 52], MUTED = [112, 120, 146];
    const ML = 14, PW = 210, CW = PW - 2 * ML;
    const tc = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const fn = (sz, st) => { doc.setFontSize(sz); doc.setFont("helvetica", st || "normal"); };

    doc.addImage("data:image/jpeg;base64," + LOGO, "JPEG", ML, 12, 18, 18);
    fn(15, "bold"); tc(NAVY); doc.text("FREIGHTYSH LLP", ML + 22, 19);
    fn(8); tc(INK); doc.text(CO.addrLine, ML + 22, 24.5);
    doc.text("GSTIN: " + CO.gstin + "    PAN: " + CO.pan + "    State: " + CO.stateName + " (" + CO.stateCode + ")", ML + 22, 29);
    fn(16, "bold"); tc(ORANGE); doc.text("CREDIT NOTE", PW - ML, 19, { align: "right" });
    doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]); doc.setLineWidth(0.6); doc.line(ML, 34, PW - ML, 34);

    fn(8.5, "bold"); tc(MUTED);
    doc.text("CREDIT NOTE NO.", ML, 42); doc.text("DATE", ML + 62, 42); doc.text("AGAINST INVOICE", ML + 100, 42); doc.text("INVOICE DATE", ML + 148, 42);
    fn(10, "bold"); tc(INK);
    doc.text(no, ML, 47.5); doc.text(date, ML + 62, 47.5); doc.text(e.invNo, ML + 100, 47.5); doc.text(e.date || "—", ML + 148, 47.5);

    fn(8.5, "bold"); tc(MUTED); doc.text("ISSUED TO", ML, 57);
    fn(10, "bold"); tc(INK); doc.text(P.name, ML, 62.5);
    fn(8.5); const addr = doc.splitTextToSize(P.address, CW * 0.65); doc.text(addr, ML, 67.5);
    let y = 67.5 + addr.length * 4;
    doc.text("GSTIN: " + (P.gstin || "—") + "    Place of supply: " + (P.state || "—") + (P.stateCode ? " (" + P.stateCode + ")" : ""), ML, y);
    y += 6;
    fn(8.5, "bold"); tc(MUTED); doc.text("REASON", ML, y);
    fn(9); tc(INK); const rs = doc.splitTextToSize(reason, CW); doc.text(rs, ML, y + 5);
    y += 6 + rs.length * 4.5;

    const cg = state.type === "cgst_sgst";
    const head = cg ? ["Description", "SAC", "Taxable", "GST %", "CGST", "SGST", "Total"] : ["Description", "SAC", "Taxable", "IGST %", "IGST", "Total"];
    const body = t.lines.map((l) => cg
      ? [l.desc, l.sac, money(l.credit), l.gst + "%", money(l.cgst), money(l.sgst), money(l.credit + l.tax)]
      : [l.desc, l.sac, money(l.credit), l.gst + "%", money(l.igst), money(l.credit + l.tax)]);
    const foot = cg
      ? [["Total", "", money(t.taxable), "", money(t.cgst), money(t.sgst), money(t.taxable + t.tax)]]
      : [["Total", "", money(t.taxable), "", money(t.igst), money(t.taxable + t.tax)]];
    doc.autoTable({
      startY: y, head: [head], body, foot, theme: "grid", margin: { left: ML, right: ML },
      styles: { fontSize: 8.5, cellPadding: 2, textColor: INK },
      headStyles: { fillColor: NAVY, textColor: 255 }, footStyles: { fillColor: [244, 247, 252], textColor: INK, fontStyle: "bold" },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, { halign: i < 2 ? "left" : "right" }])),
    });
    y = doc.lastAutoTable.finalY + 7;
    fn(9); tc(INK);
    if (t.roundOff) { doc.text("Round off: " + money(t.roundOff), PW - ML, y, { align: "right" }); y += 5; }
    fn(11, "bold"); doc.text("Credit amount: INR " + money(t.total), PW - ML, y, { align: "right" });
    fn(8.5); tc(MUTED); doc.text("In words: INR " + n2w(t.total) + " ONLY", ML, y + 6);

    y += 20;
    fn(9, "bold"); tc(NAVY); doc.text("FOR FREIGHTYSH LLP", PW - ML, y, { align: "right" });
    const sig = (root.SIG_DATA || ("data:image/jpeg;base64," + SIG)).replace(/^data:[^;]+;base64,/, "");
    doc.addImage("data:image/jpeg;base64," + sig, "JPEG", PW - ML - 44, y + 2, 42, 23);
    fn(8.5, "bold"); tc(INK); doc.text("AUTHORISED SIGNATORY", PW - ML, y + 31, { align: "right" });
    fn(7.5); tc(MUTED); doc.text("Issued under section 34 of the CGST Act, 2017.", ML, 285);
    return doc;
  }

  async function generate() {
    const CN = root.CreditNoteCalc;
    const p = CN.problem(state.lines, state.already);
    if (p) { toast(p, "err"); return; }
    const date = el("cnDate").value;
    const reason = el("cnReason").value + (el("cnNote").value.trim() ? ": " + el("cnNote").value.trim() : "");
    if (el("cnReason").value === "Other" && !el("cnNote").value.trim()) { toast("Describe the reason", "err"); return; }
    const btn = el("cnGenBtn");
    btn.disabled = true;
    try {
      const e = state.entry, t = CN.totals(state.lines, state.type);
      const no = await root.InvoiceStore.reserveNumber("credit_note", e.office, date);
      const doc = buildPDF(no, date, reason, t);
      await root.InvoiceStore.archive({
        invType: "credit_note", invNo: no, invDate: date, office: e.office,
        sellerGstin: COMPANY_PROFILES[e.office].gstin,
        customerName: state.party.name, customerGstin: state.party.gstin, amount: t.total,
        refRecordId: e.id,
        snapshot: {
          ref: { invNo: e.invNo, invDate: e.date, recordId: e.id, invType: e.invType },
          party: state.party, taxType: state.type, reason, totals: t,
        },
      }, doc.output("blob"));
      doc.save(no.split("/").join("-") + ".pdf");
      toast("Archived · " + no + " downloaded", "ok");
      close();
      renderRegister(); renderDashboard();
    } catch (err) {
      console.error(err);
      toast(err.message, "err");
      btn.disabled = false;
    }
  }

  root.CreditNote = { open, setCredit, creditAll, close, generate };
})(this);
