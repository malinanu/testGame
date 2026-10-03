-- Wildwood Arena schema. All game state is written by the `arena` Edge Function using the
-- service role; RLS is enabled with no policies, so browsers (anon/authenticated keys) can't
-- read or write these tables directly. Profiles and strongholds keep the full record in `data`,
-- with a few columns duplicated for indexing (rating, is_bot, ...).

create table if not exists public.arena_profiles (
  id uuid primary key,
  name text not null,
  rating integer not null default 1200,
  is_bot boolean not null default false,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists arena_profiles_rating on public.arena_profiles (rating desc);
create index if not exists arena_profiles_bots on public.arena_profiles (is_bot) where is_bot;

create table if not exists public.arena_strongholds (
  owner uuid primary key references public.arena_profiles (id) on delete cascade,
  version integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.arena_raids (
  id uuid primary key,
  attacker uuid not null,
  defender uuid not null,
  status text not null check (status in ('open', 'done')),
  created_at bigint not null,          -- epoch ms (matches the game clock)
  finished_at bigint,
  data jsonb not null
);
create index if not exists arena_raids_open on public.arena_raids (attacker) where status = 'open';
create index if not exists arena_raids_recent on public.arena_raids (attacker, created_at desc);
create index if not exists arena_raids_defense on public.arena_raids (defender, finished_at desc) where status = 'done';

create table if not exists public.arena_seasons (
  id integer primary key,
  data jsonb not null
);

alter table public.arena_profiles enable row level security;
alter table public.arena_strongholds enable row level security;
alter table public.arena_raids enable row level security;
alter table public.arena_seasons enable row level security;
