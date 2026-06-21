-- =============================================================================
-- CirculaID — Profile photos (avatars)
-- =============================================================================
-- Lets every user set/change their own profile photo. The file lives in a public
-- Storage bucket under a folder scoped to their user id (avatars/{uid}/...), and
-- the public URL is mirrored onto public.users.avatar_url for easy display.
-- =============================================================================

alter table public.users
  add column if not exists avatar_url text;

-- Public bucket: anyone can READ an avatar (so it can render across the app),
-- but writes are restricted by the policies below to the owner's own folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone may read avatar files (the bucket is public).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

-- A user may only create/replace/remove files inside avatars/{their-own-uid}/...
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
