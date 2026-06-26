-- Per-event volunteer scan codes. An organizer/admin generates one code per
-- event; every volunteer uses that same code to join scanning for the event.
-- The mobile scanner sends the code in the `X-Volunteer-Code` header; the
-- backend validates it (see lib/scanAuth.ts) — the Supabase key never ships.

create table if not exists public.event_volunteer_codes (
  id uuid not null default gen_random_uuid (),
  event_id uuid not null,
  code text not null,
  label text null,
  created_by text not null,
  is_active boolean not null default true,
  expires_at timestamp with time zone null,
  last_used_at timestamp with time zone null,
  use_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint event_volunteer_codes_pkey primary key (id),
  constraint event_volunteer_codes_code_key unique (code),
  constraint event_volunteer_codes_event_id_fkey foreign key (event_id) references events (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_evc_event on public.event_volunteer_codes using btree (event_id) tablespace pg_default;

create index if not exists idx_evc_code on public.event_volunteer_codes using btree (code) tablespace pg_default;
