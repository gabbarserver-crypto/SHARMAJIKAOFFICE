-- server/migrations/006_track_application_creator.sql
--
-- Nothing in the app currently records WHICH individual (the dealer
-- owner, or a specific dealer_staff login) submitted a given
-- application — only dealer_id (the dealer/company as a whole) is
-- stored. This adds that so the Dealer Portal can show a per-staff-member
-- breakdown ("who submitted what this month").
--
-- created_by_dealer_staff_id is nullable: null means the dealer owner
-- account itself submitted it (not a dealer_staff sub-login). It's not
-- possible to backfill this for existing applications — that information
-- was simply never captured — so historical rows will show as "Unknown"
-- until the app starts populating it going forward (see the DealerPortal.jsx
-- changes alongside this migration).
alter table applications
  add column if not exists created_by_dealer_staff_id uuid references dealer_staff(id) on delete set null;

create index if not exists applications_created_by_dealer_staff_id_idx
  on applications (created_by_dealer_staff_id);
