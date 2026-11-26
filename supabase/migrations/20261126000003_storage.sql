-- Private audio bucket. No storage policies are created, so only the
-- service role (used by the Edge Function) can read/write objects.
-- Size and MIME limits are enforced by Supabase Storage itself on upload.
-- Guarded so the migration also runs on plain Postgres (local mode / tests).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('performance-audio', 'performance-audio', false, 52428800,
              array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/webm'])
      on conflict (id) do update
        set public = false,
            file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $q$;
  end if;
end $$;
