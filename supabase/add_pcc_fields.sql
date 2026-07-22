-- Adds the two fields needed on the PCC request letter, so they're captured
-- once at draft time (dealer draft or staff-created application) and
-- auto-fill the letter from then on instead of being retyped by hand every
-- time it's printed.
--
-- Only shown/used on services with pcc_required = true (PCC itself, and
-- anything like "LL RIC" that bundles a PCC requirement).

alter table applications add column if not exists police_station text;
alter table applications add column if not exists stay_since date;
