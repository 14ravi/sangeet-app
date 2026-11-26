-- Sangeet Manager: core schema
-- All tables live in "public" with Row Level Security ENABLED and NO policies,
-- so the browser (anon/authenticated roles) can never read or write them.
-- Every access goes through the "api" Edge Function using the service role.

-- ---------------------------------------------------------------------------
-- Settings and global state (single-row tables)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                   int primary key default 1 check (id = 1),
  event_name           text not null default 'Sangeet' check (char_length(event_name) between 1 and 80),
  registration_enabled boolean not null default true,
  max_duration_seconds int not null default 180 check (max_duration_seconds between 10 and 3600),
  public_app_url       text check (public_app_url is null or public_app_url ~ '^https?://'),
  updated_at           timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

create table public.app_state (
  id             int primary key default 1 check (id = 1),
  order_revision bigint not null default 1,  -- bumped on reorder / add / delete (conflict detection)
  data_version   bigint not null default 1   -- bumped on ANY change to performances (cheap polling)
);
insert into public.app_state (id) values (1);

-- ---------------------------------------------------------------------------
-- Participant master list (people who may dance)
-- ---------------------------------------------------------------------------
create table public.participants (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null check (char_length(first_name) between 1 and 60),
  last_name   text not null check (char_length(last_name) between 1 and 60),
  phone       text check (phone is null or phone ~ '^\+[0-9]{8,15}$'),  -- normalized E.164, unverified, NOT unique
  email       text check (email is null or char_length(email) <= 254),
  side        text check (side in ('bride', 'groom')),
  is_active   boolean not null default true,       -- false = archived
  created_via text not null default 'admin' check (created_via in ('admin', 'registration')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index participants_phone_idx on public.participants (phone);
create index participants_name_idx on public.participants (lower(first_name), lower(last_name));

-- ---------------------------------------------------------------------------
-- Login accounts (phone + PIN). One account per normalized phone.
-- ---------------------------------------------------------------------------
create table public.participant_accounts (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid unique references public.participants (id) on delete set null,
  phone               text not null unique check (phone ~ '^\+[0-9]{8,15}$'),
  first_name          text not null,
  last_name           text not null,
  email               text,
  pin_hash            text not null,
  must_change_pin     boolean not null default false,
  temp_pin_expires_at timestamptz,
  blocked_at          timestamptz,
  last_login_at       timestamptz,
  link_status         text not null default 'linked' check (link_status in ('linked', 'pending')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Performances and their participants
-- ---------------------------------------------------------------------------
create table public.performances (
  id                    uuid primary key default gen_random_uuid(),
  display_name          text not null check (char_length(display_name) between 1 and 120),
  side                  text not null check (side in ('bride', 'groom')),
  performance_type      text not null check (performance_type in ('solo', 'group')),
  song_title            text not null check (char_length(song_title) between 1 and 200),
  normalized_song_title text not null,
  artist                text check (artist is null or char_length(artist) <= 200),
  youtube_url           text check (youtube_url is null or youtube_url ~ '^https?://'),
  audio_storage_path    text unique,
  original_filename     text,
  audio_mime_type       text,
  audio_size_bytes      bigint,
  duration_seconds      int check (duration_seconds is null or duration_seconds between 1 and 3600),
  audio_uploaded_at     timestamptz,
  admin_notes           text check (admin_notes is null or char_length(admin_notes) <= 2000),
  preparation_status    text not null default 'draft' check (preparation_status in ('draft', 'ready')),
  live_status           text not null default 'pending' check (live_status in ('pending', 'completed', 'skipped')),
  live_status_changed_at timestamptz,
  sort_order            int not null,
  version               int not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint performances_sort_order_key unique (sort_order) deferrable initially immediate
);
create index performances_song_idx on public.performances (normalized_song_title);

create table public.performance_participants (
  performance_id uuid not null references public.performances (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete restrict,
  primary key (performance_id, participant_id)
);
create index performance_participants_participant_idx on public.performance_participants (participant_id);

-- Upload slots issued by the server (finalize only accepts paths the server created)
create table public.audio_uploads (
  id                uuid primary key default gen_random_uuid(),
  performance_id    uuid not null references public.performances (id) on delete cascade,
  storage_path      text not null unique,
  original_filename text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Admin identity, sessions, throttling, audit
-- ---------------------------------------------------------------------------
create table public.admin_credentials (
  id            int primary key default 1 check (id = 1),
  username      text not null,
  password_hash text not null,
  changed_at    timestamptz not null default now()
);

create table public.auth_sessions (
  id                  uuid primary key default gen_random_uuid(),
  token_hash          text not null unique,          -- SHA-256 of the bearer token; raw token never stored
  kind                text not null check (kind in ('admin', 'participant')),
  account_id          uuid references public.participant_accounts (id) on delete cascade,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  expires_at          timestamptz not null,
  absolute_expires_at timestamptz not null,
  user_agent          text,
  check ((kind = 'admin' and account_id is null) or (kind = 'participant' and account_id is not null))
);
create index auth_sessions_account_idx on public.auth_sessions (account_id);

create table public.login_throttle (
  key             text primary key,
  failures        int not null default 0,
  locked_until    timestamptz,
  last_failure_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  actor       text not null,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public._touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger participants_touch before update on public.participants
  for each row execute function public._touch_updated_at();
create trigger accounts_touch before update on public.participant_accounts
  for each row execute function public._touch_updated_at();
create trigger performances_touch before update on public.performances
  for each row execute function public._touch_updated_at();

create function public._bump_data_version() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.app_state set data_version = data_version + 1 where id = 1;
  return null;
end $$;

create trigger performances_bump after insert or update or delete on public.performances
  for each statement execute function public._bump_data_version();
create trigger performance_participants_bump after insert or update or delete on public.performance_participants
  for each statement execute function public._bump_data_version();
create trigger participants_bump after insert or update or delete on public.participants
  for each statement execute function public._bump_data_version();

-- ---------------------------------------------------------------------------
-- Read model for performances (running position + participant names)
-- security_invoker so the view never bypasses RLS for other roles.
-- ---------------------------------------------------------------------------
create view public.performance_view with (security_invoker = true) as
select
  p.*,
  row_number() over (order by p.sort_order, p.created_at) as position,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pa.id, 'first_name', pa.first_name, 'last_name', pa.last_name,
             'side', pa.side, 'is_active', pa.is_active)
           order by lower(pa.first_name), lower(pa.last_name))
    from public.performance_participants pp
    join public.participants pa on pa.id = pp.participant_id
    where pp.performance_id = p.id
  ), '[]'::jsonb) as participants
from public.performances p;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled everywhere, no policies => deny for anon/authenticated.
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.app_state enable row level security;
alter table public.participants enable row level security;
alter table public.participant_accounts enable row level security;
alter table public.performances enable row level security;
alter table public.performance_participants enable row level security;
alter table public.audio_uploads enable row level security;
alter table public.admin_credentials enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.login_throttle enable row level security;
alter table public.admin_audit_log enable row level security;
