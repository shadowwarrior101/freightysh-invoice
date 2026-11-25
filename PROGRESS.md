# PROGRESS

## 2026-11-26: Numbering, cancel, credit notes (+ tracker Accounts & GSTR-1)

### Why
Invoice numbers were computed per browser (`lastInvNo`), so FSH/033/26-27
was issued to Carbon King (WB) and Chemstack (Odisha). There was no way to
cancel or credit an invoice, no payment tracking, and the CA got invoices by hand.

### What was done (this repo)
- **Server-issued numbers:** numbers come from `reserve_document_number()`
  on download. Number fields are read-only.
  - **Edit:** re-issues the loaded number.
  - **New / Copy / Duplicate / templates:** get the next number.
  - **Series:** FY 26-27 is one series shared by both offices
    (`FSH/{n}/26-27`, next 041). Proformas use `PRO/{n}`, credit notes
    `FSH/CN/{n}/26-27`.
- **Cancel:** a register action, permanent, reason required. The number
  can't be reused, and cancelled invoices leave receivables and dashboard revenue.
- **Credit notes:** a register action on any live invoice. The user enters the
  credit per line, and it's capped by earlier credit notes. Generates its own PDF
  (`js/credit-note.js`); the maths is in `js/credit-note-calc.js` (tested).
- **Dashboard:** revenue excludes proformas and cancelled documents, and
  subtracts credit notes.
- **Fixes:**
  - Default dates use local time; `toISOString()` gave yesterday before
    05:30 IST, and the wrong FY on 1 April.
  - Commission snapshots now save `cUsdRate`.
- **Migrations:** they now live in the **milestone tracker repo**
  (`supabase/migrations`), which owns the shared DB's history.
  `supabase/` was removed from this repo.

### Data fix
- Chemstack's FSH/033/26-27 record version was voided (`invoice_record_events`,
  event `void`) on the owner's instruction. Carbon King's FSH/033 stands;
  Chemstack's invoice is FSH/034.

### Deploy order (important)
1. Push this repo (GitHub Pages).
2. **Immediately** apply the tracker repo's
   `supabase/migrations/require_reserved_document_numbers.sql`. It rejects
   numbers not issued by the series. Applying it earlier would break the
   old app version, which still uses typed numbers.

### Open items
- FSH/036 and FSH/037 (Nov, WB office → Micbac, WB) were charged IGST on an
  intra-state supply; they should have been CGST+SGST. Raise with the CA.
- FY 27-28: add one `document_series` row per office (separate series per GSTIN)
  before 1 April 2027, or reserving a number fails with a clear message.
- Not tested with a real login. Tested: DB rules per role (SQL, rolled back),
  UI flows with the network stubbed, credit note PDF render.

## 2026-10-25: Online invoice register

### Why
Invoices lived only in each browser's localStorage (capped at 100, wiped by
"Clear All", invisible across devices). When commit 2e0398a printed an invalid
Odisha GSTIN (`21AAKFF8134C1ZF`) from 12 Sep to 25 Oct, there was no way to
list the affected invoices.

### What was done
- **Fix:** Odisha GSTIN restored to `21AAKFF8134C1ZU` (9813797).
- **`js/gstin.js`:** GSTIN format + check-digit validator. `tests/gstin.test.js`
  also asserts every Freightysh GSTIN hardcoded in `index.html` is valid and
  matches `COMPANY_PROFILES`. That would have failed CI on the 2e0398a change.
- **DB:** `supabase/migrations/20261025090040_invoice_records.sql`, applied to
  the shared Freightysh project (`bquijpcokodkluprveyn`).
  - `invoice_records`: append-only. No update/delete policies, plus a trigger that
    blocks update/delete/truncate even for service_role.
  - `invoices_current` view: latest version per (type, number).
  - Private `invoices` storage bucket for the PDFs (insert/read only).
  - Access is `freightysh_ops` role only (info@ / ops@freightysh.in). Shippers
    share this auth pool and get nothing.
  - DB-side check: app-sourced rows must have office, snapshot, PDF and a
    checksum-valid seller GSTIN (`gstin_is_valid()`).
- **App:** magic-link login gate (`shouldCreateUser: false`). Generating a PDF
  now uploads it + inserts the record **before** download. If that fails,
  no PDF. The register/dashboard read from the DB. "Clear All" removed.
  The register shows a ⚠ badge for rows printed with an invalid seller GSTIN,
  plus a link to the archived PDF.
- **Backfill:** "Import this browser's history" uploads the old localStorage
  register (`js/legacy-import.js`, tested). It reconstructs the seller GSTIN that
  was printed from the commit history:
  | Window (IST)                | Odisha            | WB                |
  |-----------------------------|-------------------|-------------------|
  | before 23 Aug 15:54         | 21…1ZU ✅          | (no WB office)    |
  | 23 Aug 15:54 – 12 Sep 18:06 | 21…1ZU ✅          | 19…1ZU ❌          |
  | 12 Sep 18:06 – 25 Oct 14:15 | 21…1ZF ❌          | 19…1ZF ✅          |
  | after                       | 21…1ZU ✅          | 19…1ZF ✅          |
  Boundaries are commit times, not deploy times.

### Decisions
- Reused the existing Freightysh Supabase project: the free tier allows 2 active
  projects and both slots are used.
- The publishable key is committed in `js/config.js`. It's public by design, and
  this is a static site with no build step for env vars. RLS is the access control.
- Tests use vitest (`npm test`). `package.json` exists only for tests; the site
  itself is still plain static files.

### Open items
- **Supabase Auth → URL Configuration:** the live site URL (and
  `http://localhost:5173` for local testing) must be in the Redirect URLs list,
  or magic links land on the tracker's Site URL.
- **Migration history is split:** the shared project's other migrations live
  in the milestone tracker repo. Copy
  `supabase/migrations/20261025090040_invoice_records.sql` there too, or
  `supabase db push` from that repo will complain about an unknown remote version.
- Each browser used for invoicing must sign in once and click "Import this
  browser's history".
- Not tested end-to-end with a real login (needs a magic link to an ops inbox).
  Tested: anon access denied, RLS per role (SQL, rolled back), archive-failure blocks
  download, record shape for tax + commission, register rendering.
- Pre-existing advisor warnings on the tracker's functions (mutable search_path,
  SECURITY DEFINER callable by anon). The tracker's `attachments` bucket is
  readable/deletable by any signed-in user, shippers included.
- Invoice numbering (`lastInvNo`) is still per-browser; next could come from
  the DB to avoid duplicates across devices.
