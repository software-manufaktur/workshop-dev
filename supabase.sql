-- Supabase Schema und RLS fuer Workshop App (Multi-Tenant, Mitgliedschaften)
create extension if not exists "pgcrypto";

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('owner', 'admin', 'user')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists workshop_states (
  org_id uuid primary key references orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists backups (
  id bigint generated always as identity primary key,
  org_id uuid references orgs(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table workshop_states enable row level security;
alter table backups enable row level security;

-- Helper: Mitgliedschaft pruefen
create policy "orgs_select_member" on orgs
  for select using (exists (select 1 from org_members m where m.org_id = id and m.user_id = auth.uid()));

create policy "orgs_insert_authenticated" on orgs
  for insert with check (auth.role() = 'authenticated');

create policy "orgs_update_admin" on orgs
  for update using (exists (select 1 from org_members m where m.org_id = id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (exists (select 1 from org_members m where m.org_id = id and m.user_id = auth.uid() and m.role in ('owner','admin')));

create policy "orgs_delete_admin" on orgs
  for delete using (exists (select 1 from org_members m where m.org_id = id and m.user_id = auth.uid() and m.role in ('owner','admin')));

create policy "members_select_same_org" on org_members
  for select using (exists (select 1 from org_members m2 where m2.org_id = org_members.org_id and m2.user_id = auth.uid()));

create policy "members_insert_self" on org_members
  for insert with check (user_id = auth.uid());

create policy "members_update_admin" on org_members
  for update using (exists (select 1 from org_members m2 where m2.org_id = org_members.org_id and m2.user_id = auth.uid() and m2.role in ('owner','admin')))
  with check (exists (select 1 from org_members m2 where m2.org_id = org_members.org_id and m2.user_id = auth.uid() and m2.role in ('owner','admin')));

create policy "members_delete_admin" on org_members
  for delete using (exists (select 1 from org_members m2 where m2.org_id = org_members.org_id and m2.user_id = auth.uid() and m2.role in ('owner','admin')));

create policy "state_select_member" on workshop_states
  for select using (exists (select 1 from org_members m where m.org_id = workshop_states.org_id and m.user_id = auth.uid()));

create policy "state_upsert_member" on workshop_states
  for all using (exists (select 1 from org_members m where m.org_id = workshop_states.org_id and m.user_id = auth.uid()))
  with check (exists (select 1 from org_members m where m.org_id = workshop_states.org_id and m.user_id = auth.uid()));

create policy "backup_select_member" on backups
  for select using (exists (select 1 from org_members m where m.org_id = backups.org_id and m.user_id = auth.uid()));

create policy "backup_insert_member" on backups
  for insert with check (exists (select 1 from org_members m where m.org_id = backups.org_id and m.user_id = auth.uid()));
