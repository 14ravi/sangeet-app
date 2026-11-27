-- Participant progress tracker v3: each person sees ONLY their own side.
-- The viewer's side comes from the participant record linked to their
-- account (set by the admin). If the account is not linked yet, or the side
-- is not set, nothing is shown (viewer_side = null) — the safe default.
-- Still finalised dances only, and still no songs, audio, order or notes.
drop function if exists public.tracker_stats(jsonb);

create function public.tracker_stats(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  with viewer as (
    select pa.side
      from public.participant_accounts a
      join public.participants pa on pa.id = a.participant_id
     where a.id = (p->>'account_id')::uuid
       and a.blocked_at is null
  ), finalised as (
    select v.* from public.performance_view v, viewer
     where v.audio_storage_path is not null and v.side = viewer.side
  ), people as (
    select pa.id, pa.first_name, pa.last_name,
           exists (select 1 from public.performance_participants pp
                     join finalised f on f.id = pp.performance_id
                    where pp.participant_id = pa.id) as included
      from public.participants pa, viewer
     where pa.is_active and pa.side = viewer.side
  )
  select jsonb_build_object(
    'viewer_side', (select side from viewer),
    'total', (select count(*) from people),
    'included', (select count(*) from people where included),
    'not_included', (select count(*) from people where not included),
    'names', coalesce((select jsonb_agg(first_name || ' ' || last_name order by lower(first_name), lower(last_name))
                         from people where included), '[]'::jsonb),
    'dances', coalesce((select jsonb_agg(jsonb_build_object(
                           'side', f.side,
                           'display_name', f.display_name,
                           'performance_type', f.performance_type,
                           'names', (select coalesce(jsonb_agg((x->>'first_name') || ' ' || (x->>'last_name')), '[]'::jsonb)
                                       from jsonb_array_elements(f.participants) x))
                         order by lower(f.display_name))
                         from finalised f), '[]'::jsonb));
$$;

revoke execute on function public.tracker_stats(jsonb) from public, anon, authenticated;
grant execute on function public.tracker_stats(jsonb) to service_role;
