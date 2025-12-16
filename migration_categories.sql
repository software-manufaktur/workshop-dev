-- =========================================================
-- Migration: Categories Spalte zu org_settings hinzufügen
-- =========================================================

-- Neue Spalte für Kategorien hinzufügen
alter table public.org_settings 
add column if not exists categories jsonb null;

-- RPC-Funktion set_org_settings erweitern
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
  -- Prüfe: Nutzer muss owner/admin sein
  perform public._require_org_role(p_org_id, array['owner','admin']);

  -- Upsert
  insert into public.org_settings (
    org_id, app_name, primary_color, accent_color, logo_url, terms_label, bookings_label, categories, updated_at
  ) values (
    p_org_id, p_app_name, p_primary_color, p_accent_color, p_logo_url, p_terms_label, p_bookings_label, p_categories, now()
  )
  on conflict (org_id) do update
  set
    app_name = coalesce(excluded.app_name, org_settings.app_name),
    primary_color = coalesce(excluded.primary_color, org_settings.primary_color),
    accent_color = coalesce(excluded.accent_color, org_settings.accent_color),
    logo_url = coalesce(excluded.logo_url, org_settings.logo_url),
    terms_label = coalesce(excluded.terms_label, org_settings.terms_label),
    bookings_label = coalesce(excluded.bookings_label, org_settings.bookings_label),
    categories = coalesce(excluded.categories, org_settings.categories),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Kommentar hinzufügen
comment on column public.org_settings.categories is 'JSON array of category strings for slot/event types';
