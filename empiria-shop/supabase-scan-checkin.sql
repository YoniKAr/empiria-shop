-- Empiria Scanner: ticket check-in columns.
-- Run once in the Supabase SQL editor (there is no migrations folder).

alter table tickets add column if not exists checked_in_at timestamptz;
alter table tickets add column if not exists checked_in_by text;
create index if not exists tickets_checked_in_at_idx on tickets (checked_in_at);
