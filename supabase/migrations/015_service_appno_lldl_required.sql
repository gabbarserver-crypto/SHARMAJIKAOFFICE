-- Adds two per-service toggles, alongside the existing pcc_required /
-- rto_required / agency_required / slot_booking_required /
-- age_limit_required columns on `services`:
--   application_no_required — when false, the Application No. cell in the
--     Applications table is disabled/greyed out for rows of that service.
--   ll_dl_no_required       — same, for the LL/DL No. cell.
--
-- Defaults to true on both, so every existing service (and every service
-- created before this migration ran) keeps behaving exactly as it does
-- today — nothing gets disabled unless someone explicitly flips it to
-- "Not Required" in Edit Service → Service Requirements.
--
-- Run this once in the Supabase SQL editor.

alter table services
  add column if not exists application_no_required boolean not null default true;

alter table services
  add column if not exists ll_dl_no_required boolean not null default true;
