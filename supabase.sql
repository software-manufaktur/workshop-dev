-- =========================================================
-- Supabase Schema & RLS v2 (Multi-Tenant, Offline-first PWA)
-- Idempotent: safe to run multiple times.
-- No recursive org_members policies. Admin actions via RPC.
-- =========================================================

-- Extensions
create extension if not exists "pgcrypto";

-- =========================================================
-- Tables
-- =========================================================

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('owner','admin','user')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.workshop_states (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.backups (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.org_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  app_name text null,
  primary_color text null,
  accent_color text null,
  logo_url text null,
  terms_label text null,
  bookings_label text null,
  categories jsonb default '["Workshop","Kurs","Event","Seminar","Kindergeburtstag"]'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Enable RLS
-- =========================================================
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.workshop_states enable row level security;
alter table public.backups enable row level security;
alter table public.org_settings enable row level security;

-- =========================================================
-- Drop existing policies (idempotent)
-- =========================================================

-- orgs
drop policy if exists orgs_select_member on public.orgs;
drop policy if exists orgs_insert_authenticated on public.orgs;
drop policy if exists orgs_update_admin on public.orgs;
drop policy if exists orgs_delete_admin on public.orgs;

-- org_members (we will NOT re-create recursive ones)
drop policy if exists members_select_same_org on public.org_members;
drop policy if exists members_insert_self on public.org_members;
drop policy if exists members_update_admin on public.org_members;
drop policy if exists members_delete_admin on public.org_members;
drop policy if exists org_members_select_self on public.org_members;

-- workshop_states
drop policy if exists state_select_member on public.workshop_states;
drop policy if exists state_insert_member on public.workshop_states;
drop policy if exists state_update_member on public.workshop_states;
drop policy if exists state_upsert_member on public.workshop_states;

-- backups
drop policy if exists backup_select_member on public.backups;
drop policy if exists backup_insert_member on public.backups;

-- org_settings
drop policy if exists org_settings_select_member on public.org_settings;
drop policy if exists org_settings_insert_admin on public.org_settings;
drop policy if exists org_settings_update_admin on public.org_settings;
drop policy if exists org_settings_delete_admin on public.org_settings;

-- =========================================================
-- Policies (non-recursive)
-- =========================================================

-- ---------- orgs ----------
-- A user can see orgs where they are a member
create policy orgs_select_member
on public.orgs
for select
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = orgs.id
      and m.user_id = auth.uid()
  )
);

-- Allow authenticated users to create an org (optional; you can disable later)
create policy orgs_insert_authenticated
on public.orgs
for insert
to authenticated
with check (true);

-- Only owner/admin can update/delete org metadata
create policy orgs_update_admin
on public.orgs
for update
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = orgs.id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
)
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = orgs.id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy orgs_delete_admin
on public.orgs
for delete
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = orgs.id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- ---------- org_members ----------
-- IMPORTANT: no recursive policy.
-- Users may only read their own membership rows.
create policy org_members_select_self
on public.org_members
for select
to authenticated
using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for org_members here.
-- Member management happens via SECURITY DEFINER RPCs below.

-- ---------- workshop_states ----------
create policy state_select_member
on public.workshop_states
for select
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = workshop_states.org_id
      and m.user_id = auth.uid()
  )
);

create policy state_insert_member
on public.workshop_states
for insert
to authenticated
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = workshop_states.org_id
      and m.user_id = auth.uid()
  )
);

create policy state_update_member
on public.workshop_states
for update
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = workshop_states.org_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = workshop_states.org_id
      and m.user_id = auth.uid()
  )
);

-- ---------- backups ----------
create policy backup_select_member
on public.backups
for select
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = backups.org_id
      and m.user_id = auth.uid()
  )
);

create policy backup_insert_member
on public.backups
for insert
to authenticated
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = backups.org_id
      and m.user_id = auth.uid()
  )
);

-- ---------- org_settings ----------
create policy org_settings_select_member
on public.org_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = org_settings.org_id
      and m.user_id = auth.uid()
  )
);

create policy org_settings_insert_admin
on public.org_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = org_settings.org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy org_settings_update_admin
on public.org_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = org_settings.org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
)
with check (
  exists (
    select 1
    from public.org_members m
    where m.org_id = org_settings.org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy org_settings_delete_admin
on public.org_settings
for delete
to authenticated
using (
  exists (
    select 1
    from public.org_members m
    where m.org_id = org_settings.org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- =========================================================
-- RPCs (SECURITY DEFINER) - Admin actions without recursive RLS
-- =========================================================

-- Helper: check role of caller in an org
create or replace function public._require_org_role(p_org_id uuid, p_roles text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.org_members
  where org_id = p_org_id
    and user_id = auth.uid();

  if v_role is null or not (v_role = any(p_roles)) then
    raise exception 'not allowed';
  end if;

  return v_role;
end;
$$;

-- Create org + make caller owner (recommended onboarding primitive)
create or replace function public.create_org(p_name text)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.orgs (name)
  values (p_name)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner')
  on conflict do nothing;

  return v_org;
end;
$$;

-- Rename organization - only owner/admin
create or replace function public.rename_org(
  p_org_id uuid,
  p_new_name text
) returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.orgs;
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  if p_new_name is null or trim(p_new_name) = '' then
    raise exception 'name cannot be empty';
  end if;

  update public.orgs
  set name = trim(p_new_name),
      updated_at = now()
  where id = p_org_id
  returning * into v_org;

  return v_org;
end;
$$;

-- Generate invite code for organization - only owner/admin
create or replace function public.generate_invite_code(
  p_org_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  -- Generate 8-character code (alphanumeric)
  v_code := upper(substring(md5(random()::text || p_org_id::text || now()::text) from 1 for 8));

  -- Store in org metadata (you could create a separate invite_codes table if needed)
  update public.orgs
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('invite_code', v_code, 'invite_expires', (now() + interval '7 days')::text)
  where id = p_org_id;

  return v_code;
end;
$$;

-- Join organization by invite code
create or replace function public.join_org_by_code(
  p_invite_code text
) returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_row public.org_members;
  v_expires timestamp;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Find org by invite code
  select id, (metadata->>'invite_expires')::timestamp
  into v_org_id, v_expires
  from public.orgs
  where metadata->>'invite_code' = upper(p_invite_code);

  if v_org_id is null then
    raise exception 'invalid invite code';
  end if;

  if v_expires < now() then
    raise exception 'invite code expired';
  end if;

  -- Add user as member
  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'user')
  on conflict (org_id, user_id) do update
    set role = excluded.role
  returning * into v_row;

  return v_row;
end;
$$;

-- Set org settings (upsert) - only owner/admin
create or replace function public.set_org_settings(
  p_org_id uuid,
  p_app_name text default null,
  p_primary_color text default null,
  p_accent_color text default null,
  p_logo_url text default null,
  p_terms_label text default null,
  p_bookings_label text default null,
  p_categories jsonb default null
) returns public.org_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.org_settings;
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  insert into public.org_settings as s (org_id, app_name, primary_color, accent_color, logo_url, terms_label, bookings_label, categories, updated_at)
  values (p_org_id, p_app_name, p_primary_color, p_accent_color, p_logo_url, p_terms_label, p_bookings_label, p_categories, now())
  on conflict (org_id) do update
    set app_name = coalesce(excluded.app_name, s.app_name),
        primary_color = coalesce(excluded.primary_color, s.primary_color),
        accent_color = coalesce(excluded.accent_color, s.accent_color),
        logo_url = coalesce(excluded.logo_url, s.logo_url),
        terms_label = coalesce(excluded.terms_label, s.terms_label),
        bookings_label = coalesce(excluded.bookings_label, s.bookings_label),
        categories = coalesce(excluded.categories, s.categories),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Add existing user (by email) to org - only owner/admin
-- Note: user must already exist in auth.users (must have logged in once).
create or replace function public.add_member_by_email(
  p_org_id uuid,
  p_email text,
  p_role text default 'user'
) returns public.org_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_row public.org_members;
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  if p_role not in ('owner','admin','user') then
    raise exception 'invalid role';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user_id is null then
    raise exception 'user not found (must login once first)';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (p_org_id, v_user_id, p_role)
  on conflict (org_id, user_id) do update
    set role = excluded.role
  returning * into v_row;

  return v_row;
end;
$$;

-- Change role - only owner/admin
create or replace function public.set_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
) returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.org_members;
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  if p_role not in ('owner','admin','user') then
    raise exception 'invalid role';
  end if;

  update public.org_members
  set role = p_role
  where org_id = p_org_id and user_id = p_user_id
  returning * into v_row;

  if v_row.org_id is null then
    raise exception 'member not found';
  end if;

  return v_row;
end;
$$;

-- Remove member - only owner/admin
create or replace function public.remove_member(
  p_org_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_org_role(p_org_id, array['owner','admin']);

  delete from public.org_members
  where org_id = p_org_id and user_id = p_user_id;

  return;
end;
$$;

-- Optional: keep updated_at fresh on workshop_states updates
create or replace function public._touch_workshop_states()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_workshop_states on public.workshop_states;
create trigger trg_touch_workshop_states
before update on public.workshop_states
for each row
execute function public._touch_workshop_states();
