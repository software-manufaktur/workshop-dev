-- Migration: Organisation Management Features
-- Fügt Funktionen für Umbenennen, Einladungscodes und Beitreten hinzu

-- 1. Add metadata column to orgs table (if not exists)
-- This will store invite codes and other org-specific data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'orgs' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.orgs ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
    COMMENT ON COLUMN public.orgs.metadata IS 'Stores invite codes and other org metadata';
  END IF;
END $$;

-- 2. Rename organization function (already added to supabase.sql)
-- Run the complete supabase.sql or just this section:
/*
CREATE OR REPLACE FUNCTION public.rename_org(
  p_org_id uuid,
  p_new_name text
) RETURNS public.orgs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.orgs;
BEGIN
  PERFORM public._require_org_role(p_org_id, array['owner','admin']);

  IF p_new_name IS NULL OR trim(p_new_name) = '' THEN
    RAISE EXCEPTION 'name cannot be empty';
  END IF;

  UPDATE public.orgs
  SET name = trim(p_new_name),
      updated_at = now()
  WHERE id = p_org_id
  RETURNING * INTO v_org;

  RETURN v_org;
END;
$$;
*/

-- 3. Generate invite code function (already added to supabase.sql)
/*
CREATE OR REPLACE FUNCTION public.generate_invite_code(
  p_org_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  PERFORM public._require_org_role(p_org_id, array['owner','admin']);

  -- Generate 8-character code (alphanumeric)
  v_code := upper(substring(md5(random()::text || p_org_id::text || now()::text) from 1 for 8));

  -- Store in org metadata with 7-day expiration
  UPDATE public.orgs
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'invite_code', v_code, 
    'invite_expires', (now() + interval '7 days')::text
  )
  WHERE id = p_org_id;

  RETURN v_code;
END;
$$;
*/

-- 4. Join organization by invite code (already added to supabase.sql)
/*
CREATE OR REPLACE FUNCTION public.join_org_by_code(
  p_invite_code text
) RETURNS public.org_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row public.org_members;
  v_expires timestamp;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Find org by invite code
  SELECT id, (metadata->>'invite_expires')::timestamp
  INTO v_org_id, v_expires
  FROM public.orgs
  WHERE metadata->>'invite_code' = upper(p_invite_code);

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'invalid invite code';
  END IF;

  IF v_expires < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;

  -- Add user as member
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_org_id, auth.uid(), 'user')
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = excluded.role
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
*/

-- Instructions:
-- 1. Execute this migration in Supabase SQL Editor
-- 2. The metadata column will be added to orgs table
-- 3. The three functions (rename_org, generate_invite_code, join_org_by_code) 
--    are already in your main supabase.sql file - make sure to run that file
--    or copy the functions from the comments above

-- Verify installation:
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('rename_org', 'generate_invite_code', 'join_org_by_code')
ORDER BY routine_name;

-- Expected result: 3 rows showing the functions exist
