-- Participant progress tracker v2: based on FINALISED dances only
-- (= performances with an uploaded audio clip). Drafts without audio are
-- not counted and not listed. Adds the list of finalised dances
-- (side, dance name, Solo/Group, performer names) sorted alphabetically —
-- never song titles, audio, running order or notes.
create or replace function public.tracker_stats(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  with finalised as (
    select * from public.performance_view where audio_storage_path is not null
  ), people as (
    select pa.id, pa.first_name, pa.last_name, pa.side,
           exists (select 1 from public.performance_participants pp
                     join finalised f on f.id = pp.performance_id
                    where pp.participant_id = pa.id) as included
      from public.participants pa
     where pa.is_active
  )
  select jsonb_build_object(
    'total', (select count(*) from people),
    'included', (select count(*) from people where included),
    'not_included', (select count(*) from people where not included),
    'by_side', jsonb_build_object(
      'bride', jsonb_build_object('total', (select count(*) from people where side = 'bride'),
                                  'included', (select count(*) from people where side = 'bride' and included)),
      'groom', jsonb_build_object('total', (select count(*) from people where side = 'groom'),
                                  'included', (select count(*) from people where side = 'groom' and included))),
    'names', coalesce((select jsonb_agg(first_name || ' ' || last_name order by lower(first_name), lower(last_name))
                         from people where included), '[]'::jsonb),
    'dances', coalesce((select jsonb_agg(jsonb_build_object(
                           'side', f.side,
                           'display_name', f.display_name,
                           'performance_type', f.performance_type,
                           'names', (select coalesce(jsonb_agg((x->>'first_name') || ' ' || (x->>'last_name')), '[]'::jsonb)
                                       from jsonb_array_elements(f.participants) x))
                         order by f.side, lower(f.display_name))
                         from finalised f), '[]'::jsonb));
$$;

revoke execute on function public.tracker_stats(jsonb) from public, anon, authenticated;
grant execute on function public.tracker_stats(jsonb) to service_role;
