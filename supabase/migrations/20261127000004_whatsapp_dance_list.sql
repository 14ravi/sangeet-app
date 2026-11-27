-- WhatsApp share message v2: list FINALIZED dances (= audio clip uploaded),
-- grouped by side, with dance name, Solo/Group and performer names.
-- Deliberately NOT included: song titles, audio links, running-order
-- position, admin notes. Sorted alphabetically so the running order is not revealed.
create function public.admin_whatsapp_dances(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'event_name', (select event_name from public.app_settings where id = 1),
    'dances', coalesce(jsonb_agg(jsonb_build_object(
        'side', v.side,
        'display_name', v.display_name,
        'performance_type', v.performance_type,
        'names', (select coalesce(jsonb_agg((x->>'first_name') || ' ' || (x->>'last_name')), '[]'::jsonb)
                    from jsonb_array_elements(v.participants) x))
      order by v.side, lower(v.display_name)), '[]'::jsonb))
  from public.performance_view v
  where v.audio_storage_path is not null;
$$;

revoke execute on function public.admin_whatsapp_dances(jsonb) from public, anon, authenticated;
grant execute on function public.admin_whatsapp_dances(jsonb) to service_role;
