-- Append-only archive of every invoice the freightysh-invoice app generates.
--
-- Lives in the shared Freightysh project (same DB as the milestone tracker).
-- Every PDF download writes one row + the PDF itself; nothing is ever updated
-- or deleted, so "which invoices printed GSTIN X" is always answerable.
--
-- Access: freightysh_ops only (shippers share this auth pool and must never
-- see invoices). The role is protected by clamp_profile_role().

-- ─── GSTIN check digit (mirrors js/gstin.js) ────────────────────────────────
create or replace function public.gstin_is_valid(g text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  cs constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s int := 0;
  p int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    return false;
  end if;
  for i in 1..14 loop
    p := (strpos(cs, substr(g, i, 1)) - 1) * (case when i % 2 = 1 then 1 else 2 end);
    s := s + p / 36 + p % 36;
  end loop;
  return substr(g, 15, 1) = substr(cs, ((36 - s % 36) % 36) + 1, 1);
end;
$$;

-- ─── Records ────────────────────────────────────────────────────────────────
create table public.invoice_records (
  id             uuid primary key default gen_random_uuid(),
  inv_type       text not null check (inv_type in ('tax', 'proforma', 'commission')),
  inv_no         text not null check (length(trim(inv_no)) > 0),
  inv_date       date,
  office         text check (office in ('odisha', 'wb')),
  seller_gstin   text,            -- exactly as printed on the PDF
  customer_name  text,
  customer_gstin text,
  amount         numeric(14, 2),
  snapshot       jsonb,           -- full form state; lets the app reload the invoice
  pdf_path       text,            -- object path in the 'invoices' storage bucket
  -- 'app'    = written by the app at download time
  -- 'import' = backfilled from a browser's old localStorage register; office
  --            and seller_gstin are reconstructed and may be null
  source         text not null default 'app' check (source in ('app', 'import')),
  issued_at      timestamptz not null default now(),  -- when the PDF was generated
  created_by     uuid not null default auth.uid() references auth.users (id),
  created_at     timestamptz not null default now(),
  -- The app may only archive complete records with a valid seller GSTIN.
  -- Imports keep whatever was printed, valid or not; that's the point.
  constraint app_record_complete check (
    source = 'import'
    or (office is not null and snapshot is not null and pdf_path is not null
        and public.gstin_is_valid(seller_gstin))
  )
);

create index invoice_records_inv_no_idx on public.invoice_records (upper(trim(inv_no)));
create index invoice_records_issued_at_idx on public.invoice_records (issued_at desc);
-- Re-running an import from the same browser must not duplicate rows.
create unique index invoice_records_import_once
  on public.invoice_records (inv_type, inv_no, issued_at)
  where source = 'import';

-- Immutable, even for service_role / dashboard edits.
create or replace function public.invoice_records_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'invoice_records is append-only; insert a new version instead';
end;
$$;

create trigger invoice_records_no_update_delete
  before update or delete on public.invoice_records
  for each row execute function public.invoice_records_immutable();

create trigger invoice_records_no_truncate
  before truncate on public.invoice_records
  for each statement execute function public.invoice_records_immutable();

-- Latest version per invoice: what the register and dashboard show.
create view public.invoices_current
with (security_invoker = true) as
  select distinct on (inv_type, upper(trim(inv_no))) *
  from public.invoice_records
  order by inv_type, upper(trim(inv_no)), issued_at desc;

-- ─── RLS + grants ───────────────────────────────────────────────────────────
alter table public.invoice_records enable row level security;

create policy invoice_records_ops_select on public.invoice_records
  for select to authenticated
  using (public.get_my_role() = 'freightysh_ops');

create policy invoice_records_ops_insert on public.invoice_records
  for insert to authenticated
  with check (public.get_my_role() = 'freightysh_ops' and created_by = auth.uid());

-- Undo any default-privilege auto-grants, then grant only what the app needs.
revoke all on table public.invoice_records from anon, authenticated;
revoke all on table public.invoices_current from anon, authenticated;
grant select, insert on table public.invoice_records to authenticated;
grant select on table public.invoices_current to authenticated;
grant all on table public.invoice_records to service_role;
grant select on table public.invoices_current to service_role;

-- ─── PDF storage ────────────────────────────────────────────────────────────
-- Separate private bucket: the existing 'attachments' policies let any
-- authenticated user (shippers included) read it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy invoices_ops_read on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and public.get_my_role() = 'freightysh_ops');

create policy invoices_ops_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and public.get_my_role() = 'freightysh_ops');
-- No update/delete policies: archived PDFs can't be overwritten or removed.
