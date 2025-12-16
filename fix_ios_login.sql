-- =========================================================
-- User erstmalig mit Organisation verknüpfen
-- =========================================================

-- Option 1: Manuell einen bestehenden User zu einer Org hinzufügen
-- Ersetze die UUIDs mit deinen echten Werten

-- Schritt 1: Finde die User-ID
-- select id, email from auth.users;

-- Schritt 2: Erstelle eine Organisation (falls noch keine existiert)
-- insert into public.orgs (name) values ('Mein Team')
-- returning id;

-- Schritt 3: Verknüpfe User mit Organisation als Owner
-- insert into public.org_members (org_id, user_id, role)
-- values (
--   'DEINE-ORG-UUID-HIER',  -- org_id aus Schritt 2
--   'DEINE-USER-UUID-HIER', -- user_id aus Schritt 1
--   'owner'
-- );

-- =========================================================
-- BESSERE LÖSUNG: Automatische Org-Erstellung beim ersten Login
-- =========================================================

-- Diese Funktion erstellt automatisch eine persönliche Organisation
-- für jeden neuen User beim ersten Login
create or replace function public.ensure_user_has_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_count int;
begin
  -- Prüfe, ob User bereits einer Organisation zugeordnet ist
  select count(*) into v_org_count
  from public.org_members
  where user_id = new.id;
  
  -- Wenn User noch keiner Org zugeordnet ist, erstelle eine persönliche Org
  if v_org_count = 0 then
    -- Erstelle neue Organisation mit User-Email als Name
    insert into public.orgs (name)
    values (coalesce(new.email, 'Persönlicher Workspace'))
    returning id into v_org_id;
    
    -- Verknüpfe User als Owner mit der neuen Organisation
    insert into public.org_members (org_id, user_id, role)
    values (v_org_id, new.id, 'owner');
    
    raise notice 'Automatisch Organisation erstellt für User %', new.email;
  end if;
  
  return new;
end;
$$;

-- Trigger: Wird ausgelöst bei jedem neuen User in auth.users
drop trigger if exists trg_ensure_user_has_org on auth.users;
create trigger trg_ensure_user_has_org
after insert on auth.users
for each row
execute function public.ensure_user_has_org();

-- =========================================================
-- Für bestehende User ohne Organisation (einmalig ausführen)
-- =========================================================

do $$
declare
  v_user record;
  v_org_id uuid;
begin
  -- Für jeden User ohne Organisation
  for v_user in
    select u.id, u.email
    from auth.users u
    left join public.org_members m on m.user_id = u.id
    where m.user_id is null
  loop
    -- Erstelle persönliche Organisation
    insert into public.orgs (name)
    values (coalesce(v_user.email, 'Persönlicher Workspace'))
    returning id into v_org_id;
    
    -- Verknüpfe User als Owner
    insert into public.org_members (org_id, user_id, role)
    values (v_org_id, v_user.id, 'owner');
    
    raise notice 'Organisation erstellt für bestehenden User: %', v_user.email;
  end loop;
end;
$$;
