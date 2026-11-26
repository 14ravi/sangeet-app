-- Sangeet Manager: server-side SQL functions.
-- Convention: every function takes ONE jsonb argument "p" and returns jsonb.
-- Expected business failures are returned as {"error": "<code>", ...};
-- unexpected failures raise. Functions are SECURITY INVOKER and are only
-- executable by service_role (see the privileges section at the bottom).
-- Hashing of PINs/passwords happens in the Edge Function, never here.

-- ===========================================================================
-- Helpers
-- ===========================================================================
create function public._perf_json(v public.performance_view) returns jsonb
language sql stable set search_path = public as $$
  select (to_jsonb(v) - 'audio_storage_path' - 'audio_size_bytes')
         || jsonb_build_object('has_audio', v.audio_storage_path is not null);
$$;

create function public._audit(p_action text, p_target_type text, p_target_id text, p_details jsonb, p_actor text)
returns void language sql set search_path = public as $$
  insert into public.admin_audit_log (action, target_type, target_id, details, actor)
  values (p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb), coalesce(p_actor, 'admin'));
$$;

create function public._nullif_blank(t text) returns text
language sql immutable as $$ select nullif(btrim(t), '') $$;

-- ===========================================================================
-- Public config
-- ===========================================================================
create function public.public_config(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('event_name', s.event_name, 'registration_enabled', s.registration_enabled)
  from public.app_settings s where s.id = 1;
$$;

-- ===========================================================================
-- Sessions
-- ===========================================================================
create function public.auth_session_create(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  insert into public.auth_sessions (token_hash, kind, account_id, expires_at, absolute_expires_at, user_agent)
  values (
    p->>'token_hash', p->>'kind', (p->>'account_id')::uuid,
    now() + make_interval(secs => (p->>'idle_seconds')::int),
    now() + make_interval(secs => (p->>'absolute_seconds')::int),
    left(p->>'user_agent', 200))
  returning id into v_id;
  -- opportunistic cleanup of expired sessions
  delete from public.auth_sessions where expires_at < now() or absolute_expires_at < now();
  return jsonb_build_object('session_id', v_id);
end $$;

create function public.auth_session_resolve(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare s public.auth_sessions; a public.participant_accounts;
begin
  select * into s from public.auth_sessions where token_hash = p->>'token_hash';
  if not found or s.kind <> p->>'kind' then
    return jsonb_build_object('found', false);
  end if;
  if s.expires_at <= now() or s.absolute_expires_at <= now() then
    delete from public.auth_sessions where id = s.id;
    return jsonb_build_object('found', false);
  end if;
  if s.last_seen_at < now() - interval '60 seconds' then
    update public.auth_sessions
       set last_seen_at = now(),
           expires_at = least(now() + make_interval(secs => (p->>'idle_seconds')::int), absolute_expires_at)
     where id = s.id;
  end if;
  if s.kind = 'admin' then
    return jsonb_build_object('found', true, 'session_id', s.id, 'kind', 'admin');
  end if;
  select * into a from public.participant_accounts where id = s.account_id;
  if not found then
    delete from public.auth_sessions where id = s.id;
    return jsonb_build_object('found', false);
  end if;
  if a.blocked_at is not null then
    delete from public.auth_sessions where account_id = a.id;
    return jsonb_build_object('found', true, 'blocked', true);
  end if;
  return jsonb_build_object(
    'found', true, 'blocked', false, 'session_id', s.id, 'kind', 'participant',
    'account_id', a.id, 'participant_id', a.participant_id,
    'must_change_pin', a.must_change_pin, 'link_status', a.link_status);
end $$;

create function public.auth_session_delete(p jsonb) returns jsonb
language sql set search_path = public as $$
  with d as (delete from public.auth_sessions where token_hash = p->>'token_hash' returning 1)
  select jsonb_build_object('deleted', (select count(*) from d));
$$;

-- ===========================================================================
-- Login throttling (progressive lockout). Keys are opaque strings such as
-- 'phone:+919812345678', 'ip:1.2.3.4', 'admin-user:owner'.
-- Lock schedule per "step" failures: 1 min, 5 min, 15 min, then 60 min.
-- ===========================================================================
create function public.throttle_check(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_until timestamptz;
begin
  select max(locked_until) into v_until
    from public.login_throttle
   where key in (select jsonb_array_elements_text(p->'keys'));
  if v_until is not null and v_until > now() then
    return jsonb_build_object('locked', true,
      'retry_after_seconds', ceil(extract(epoch from (v_until - now())))::int);
  end if;
  return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
end $$;

create function public.throttle_fail(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  it jsonb; v_key text; v_step int; v_window interval; v_fail int; v_level int;
  schedule int[] := array[60, 300, 900, 3600];
begin
  for it in select * from jsonb_array_elements(p->'items') loop
    v_key := it->>'key';
    v_step := greatest(1, coalesce((it->>'step')::int, 5));
    v_window := make_interval(secs => coalesce((it->>'window_seconds')::int, 86400));
    insert into public.login_throttle as t (key, failures, last_failure_at)
    values (v_key, 1, now())
    on conflict (key) do update
      set failures = case when t.last_failure_at < now() - v_window then 1 else t.failures + 1 end,
          last_failure_at = now()
    returning failures into v_fail;
    if v_fail % v_step = 0 then
      v_level := least(v_fail / v_step, array_length(schedule, 1));
      update public.login_throttle
         set locked_until = now() + make_interval(secs => schedule[v_level])
       where key = v_key;
    end if;
  end loop;
  delete from public.login_throttle
   where last_failure_at < now() - interval '2 days'
     and (locked_until is null or locked_until < now());
  return public.throttle_check(jsonb_build_object('keys',
    (select coalesce(jsonb_agg(x->'key'), '[]'::jsonb) from jsonb_array_elements(p->'items') x)));
end $$;

create function public.throttle_clear(p jsonb) returns jsonb
language sql set search_path = public as $$
  with d as (delete from public.login_throttle
             where key in (select jsonb_array_elements_text(p->'keys')) returning 1)
  select jsonb_build_object('cleared', (select count(*) from d));
$$;

-- ===========================================================================
-- Participant auth
-- ===========================================================================
create function public.participant_get_for_login(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('found', true, 'account_id', a.id, 'pin_hash', a.pin_hash,
              'blocked', a.blocked_at is not null, 'must_change_pin', a.must_change_pin,
              'temp_pin_expired', a.must_change_pin and (a.temp_pin_expires_at is null or a.temp_pin_expires_at < now()))
       from public.participant_accounts a
      where a.phone = coalesce(p->>'phone', '') or a.id::text = coalesce(p->>'account_id', '')
      limit 1),
    jsonb_build_object('found', false));
$$;

create function public.participant_login_success(p jsonb) returns jsonb
language sql set search_path = public as $$
  update public.participant_accounts set last_login_at = now() where id = (p->>'account_id')::uuid;
  select jsonb_build_object('ok', true);
$$;

create function public.participant_register(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_phone text := p->>'phone';
  v_first text := btrim(p->>'first_name');
  v_last text := btrim(p->>'last_name');
  v_email text := public._nullif_blank(p->>'email');
  v_pid uuid; v_acc uuid; v_candidates int;
begin
  if not (select registration_enabled from public.app_settings where id = 1) then
    return jsonb_build_object('error', 'registration_closed');
  end if;
  if exists (select 1 from public.participant_accounts where phone = v_phone) then
    return jsonb_build_object('error', 'phone_taken');
  end if;
  -- Any unlinked participant with the same (unverified) phone => admin must confirm.
  select count(*) into v_candidates
    from public.participants pa
   where pa.phone = v_phone
     and not exists (select 1 from public.participant_accounts ac where ac.participant_id = pa.id);
  if v_candidates = 0 then
    insert into public.participants (first_name, last_name, phone, email, created_via)
    values (v_first, v_last, v_phone, v_email, 'registration')
    returning id into v_pid;
  end if;
  insert into public.participant_accounts (participant_id, phone, first_name, last_name, email, pin_hash, link_status)
  values (v_pid, v_phone, v_first, v_last, v_email, p->>'pin_hash',
          case when v_pid is null then 'pending' else 'linked' end)
  returning id into v_acc;
  return jsonb_build_object('account_id', v_acc,
    'link_status', case when v_pid is null then 'pending' else 'linked' end);
exception when unique_violation then
  return jsonb_build_object('error', 'phone_taken');
end $$;

create function public.participant_me(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'account_id', a.id,
    'first_name', coalesce(pa.first_name, a.first_name),
    'last_name', coalesce(pa.last_name, a.last_name),
    'phone', a.phone,
    'must_change_pin', a.must_change_pin,
    'link_status', a.link_status,
    'linked', a.participant_id is not null)
  from public.participant_accounts a
  left join public.participants pa on pa.id = a.participant_id
  where a.id = (p->>'account_id')::uuid;
$$;

create function public.participant_change_pin(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  update public.participant_accounts
     set pin_hash = p->>'pin_hash', must_change_pin = false, temp_pin_expires_at = null
   where id = (p->>'account_id')::uuid;
  delete from public.auth_sessions
   where account_id = (p->>'account_id')::uuid
     and id <> coalesce((p->>'keep_session_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  return jsonb_build_object('ok', true);
end $$;

-- ===========================================================================
-- Progress tracker (privacy-safe: names + counts only)
-- ===========================================================================
create function public.tracker_stats(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  with people as (
    select pa.id, pa.first_name, pa.last_name, pa.side,
           exists (select 1 from public.performance_participants pp where pp.participant_id = pa.id) as included
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
                         from people where included), '[]'::jsonb));
$$;

create function public.participant_my_performances(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'display_name', v.display_name, 'song_title', v.song_title,
           'side', v.side, 'performance_type', v.performance_type,
           'duration_seconds', v.duration_seconds, 'has_audio', v.audio_storage_path is not null,
           'participants', (select jsonb_agg(x->>'first_name' || ' ' || (x->>'last_name')) from jsonb_array_elements(v.participants) x))
         order by v.position), '[]'::jsonb)
  from public.performance_view v
  join public.participant_accounts a on a.id = (p->>'account_id')::uuid and a.participant_id is not null
  where exists (select 1 from public.performance_participants pp
                 where pp.performance_id = v.id and pp.participant_id = a.participant_id);
$$;

-- Info needed to sign an audio URL + build its download filename.
-- If account_id is given, the account must be linked to a participant of the performance.
create function public.performance_file_info(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare v public.performance_view; v_pid uuid;
begin
  select * into v from public.performance_view where id = (p->>'performance_id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p ? 'account_id' then
    select participant_id into v_pid from public.participant_accounts
     where id = (p->>'account_id')::uuid and blocked_at is null;
    if v_pid is null or not exists (select 1 from public.performance_participants
                                     where performance_id = v.id and participant_id = v_pid) then
      return jsonb_build_object('error', 'forbidden');
    end if;
  end if;
  if v.audio_storage_path is null then return jsonb_build_object('error', 'no_audio'); end if;
  return jsonb_build_object(
    'path', v.audio_storage_path, 'mime_type', v.audio_mime_type, 'original_filename', v.original_filename,
    'position', v.position, 'side', v.side, 'performance_type', v.performance_type,
    'duration_seconds', v.duration_seconds, 'display_name', v.display_name,
    'first_names', (select coalesce(jsonb_agg(x->>'first_name'), '[]'::jsonb) from jsonb_array_elements(v.participants) x));
end $$;

-- ===========================================================================
-- Admin credentials
-- ===========================================================================
create function public.admin_get_credentials(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('found', true, 'username', username, 'password_hash', password_hash)
       from public.admin_credentials where id = 1),
    jsonb_build_object('found', false));
$$;

create function public.admin_bootstrap(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  insert into public.admin_credentials (id, username, password_hash)
  values (1, p->>'username', p->>'password_hash')
  on conflict (id) do nothing;
  if found then
    perform public._audit('admin_bootstrap', 'admin', null, '{}'::jsonb, 'system');
  end if;
  return public.admin_get_credentials('{}'::jsonb);
end $$;

create function public.admin_set_credentials(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  update public.admin_credentials
     set username = p->>'username', password_hash = p->>'password_hash', changed_at = now()
   where id = 1;
  delete from public.auth_sessions
   where kind = 'admin' and id <> (p->>'keep_session_id')::uuid;
  perform public._audit('admin_password_change', 'admin', null,
    jsonb_build_object('username_changed', coalesce((p->>'username_changed')::boolean, false)), p->>'actor');
  return jsonb_build_object('ok', true);
end $$;

-- ===========================================================================
-- Admin dashboard
-- ===========================================================================
create function public.admin_dashboard(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  with people as (
    select pa.side,
           exists (select 1 from public.performance_participants pp where pp.participant_id = pa.id) as included
      from public.participants pa where pa.is_active
  ), s as (select * from public.app_settings where id = 1)
  select jsonb_build_object(
    'registered_accounts', (select count(*) from public.participant_accounts),
    'participants_total', (select count(*) from people),
    'included', (select count(*) from people where included),
    'not_included', (select count(*) from people where not included),
    'performances_total', (select count(*) from public.performances),
    'performances_ready', (select count(*) from public.performances where preparation_status = 'ready'),
    'performances_without_audio', (select count(*) from public.performances where audio_storage_path is null),
    'over_duration', (select count(*) from public.performances, s where duration_seconds > s.max_duration_seconds),
    'duplicate_titles', (select count(*) from (select 1 from public.performances
                           group by normalized_song_title having count(*) > 1) d),
    'pending_links', (select count(*) from public.participant_accounts where link_status = 'pending'),
    'blocked_accounts', (select count(*) from public.participant_accounts where blocked_at is not null),
    'by_side', jsonb_build_object(
      'bride', jsonb_build_object('total', (select count(*) from people where side = 'bride'),
                                  'included', (select count(*) from people where side = 'bride' and included),
                                  'performances', (select count(*) from public.performances where side = 'bride')),
      'groom', jsonb_build_object('total', (select count(*) from people where side = 'groom'),
                                  'included', (select count(*) from people where side = 'groom' and included),
                                  'performances', (select count(*) from public.performances where side = 'groom')),
      'unassigned', (select count(*) from people where side is null)),
    'live', jsonb_build_object(
      'pending', (select count(*) from public.performances where live_status = 'pending'),
      'completed', (select count(*) from public.performances where live_status = 'completed'),
      'skipped', (select count(*) from public.performances where live_status = 'skipped')),
    'max_duration_seconds', (select max_duration_seconds from s),
    'event_name', (select event_name from s));
$$;

create function public.admin_progress_names(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('event_name', (select event_name from public.app_settings where id = 1),
    'names', coalesce(jsonb_agg(distinct_name order by lower(distinct_name)), '[]'::jsonb))
  from (
    select distinct btrim(pa.first_name) || ' ' || btrim(pa.last_name) as distinct_name
      from public.participants pa
     where pa.is_active
       and exists (select 1 from public.performance_participants pp where pp.participant_id = pa.id)
  ) n;
$$;

-- ===========================================================================
-- Admin: participants & accounts
-- ===========================================================================
create function public._participant_admin_json(pa public.participants) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(pa) || jsonb_build_object(
    'performance_count', (select count(*) from public.performance_participants pp where pp.participant_id = pa.id),
    'account', (select jsonb_build_object(
                  'id', a.id, 'phone', a.phone, 'first_name', a.first_name, 'last_name', a.last_name,
                  'email', a.email, 'registered_at', a.created_at, 'last_login_at', a.last_login_at,
                  'blocked', a.blocked_at is not null, 'blocked_at', a.blocked_at,
                  'must_change_pin', a.must_change_pin, 'temp_pin_expires_at', a.temp_pin_expires_at)
                from public.participant_accounts a where a.participant_id = pa.id));
$$;

create function public.admin_participants_list(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'participants', coalesce((
      select jsonb_agg(public._participant_admin_json(pa) order by lower(pa.first_name), lower(pa.last_name))
        from public.participants pa), '[]'::jsonb),
    'pending_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'phone', a.phone, 'first_name', a.first_name, 'last_name', a.last_name,
               'email', a.email, 'registered_at', a.created_at, 'blocked', a.blocked_at is not null,
               'candidates', coalesce((
                 select jsonb_agg(jsonb_build_object('id', pa.id, 'first_name', pa.first_name,
                          'last_name', pa.last_name, 'side', pa.side))
                   from public.participants pa
                  where pa.phone = a.phone
                    and not exists (select 1 from public.participant_accounts x where x.participant_id = pa.id)),
                 '[]'::jsonb))
             order by a.created_at)
        from public.participant_accounts a where a.link_status = 'pending'), '[]'::jsonb));
$$;

create function public.admin_participant_get(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare pa public.participants;
begin
  select * into pa from public.participants where id = (p->>'id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object(
    'participant', public._participant_admin_json(pa),
    'performances', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'display_name', v.display_name, 'song_title', v.song_title,
               'side', v.side, 'performance_type', v.performance_type, 'position', v.position,
               'live_status', v.live_status, 'preparation_status', v.preparation_status) order by v.position)
        from public.performance_view v
       where exists (select 1 from public.performance_participants pp
                      where pp.performance_id = v.id and pp.participant_id = pa.id)), '[]'::jsonb),
    'same_phone', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'first_name', o.first_name, 'last_name', o.last_name))
        from public.participants o where o.phone = pa.phone and o.id <> pa.id), '[]'::jsonb));
end $$;

create function public.admin_participant_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_id uuid; pa public.participants;
begin
  if p->>'id' is null then
    insert into public.participants (first_name, last_name, phone, email, side, created_via)
    values (btrim(p->>'first_name'), btrim(p->>'last_name'), public._nullif_blank(p->>'phone'),
            public._nullif_blank(p->>'email'), public._nullif_blank(p->>'side'), 'admin')
    returning id into v_id;
  else
    update public.participants
       set first_name = btrim(p->>'first_name'), last_name = btrim(p->>'last_name'),
           phone = public._nullif_blank(p->>'phone'), email = public._nullif_blank(p->>'email'),
           side = public._nullif_blank(p->>'side')
     where id = (p->>'id')::uuid
    returning id into v_id;
    if v_id is null then return jsonb_build_object('error', 'not_found'); end if;
  end if;
  select * into pa from public.participants where id = v_id;
  return jsonb_build_object('participant', public._participant_admin_json(pa),
    'same_phone_count', (select count(*) from public.participants o where o.phone = pa.phone and o.id <> pa.id));
end $$;

create function public.admin_participant_set_active(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  update public.participants set is_active = (p->>'active')::boolean where id = (p->>'id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public._audit(case when (p->>'active')::boolean then 'participant_restore' else 'participant_archive' end,
                        'participant', p->>'id', '{}'::jsonb, p->>'actor');
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_participant_delete(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare pa public.participants;
begin
  select * into pa from public.participants where id = (p->>'id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if exists (select 1 from public.performance_participants where participant_id = pa.id) then
    return jsonb_build_object('error', 'has_performances');
  end if;
  if exists (select 1 from public.participant_accounts where participant_id = pa.id) then
    return jsonb_build_object('error', 'has_account');
  end if;
  delete from public.participants where id = pa.id;
  perform public._audit('participant_delete', 'participant', pa.id::text,
    jsonb_build_object('name', pa.first_name || ' ' || pa.last_name), p->>'actor');
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_account_block(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_blocked boolean := (p->>'blocked')::boolean;
begin
  update public.participant_accounts
     set blocked_at = case when v_blocked then coalesce(blocked_at, now()) else null end
   where id = (p->>'account_id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_blocked then
    delete from public.auth_sessions where account_id = (p->>'account_id')::uuid;
  end if;
  perform public._audit(case when v_blocked then 'account_block' else 'account_unblock' end,
                        'account', p->>'account_id', '{}'::jsonb, p->>'actor');
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_account_reset_pin(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_phone text;
begin
  update public.participant_accounts
     set pin_hash = p->>'pin_hash', must_change_pin = true,
         temp_pin_expires_at = (p->>'expires_at')::timestamptz
   where id = (p->>'account_id')::uuid
  returning phone into v_phone;
  if v_phone is null then return jsonb_build_object('error', 'not_found'); end if;
  delete from public.auth_sessions where account_id = (p->>'account_id')::uuid;
  delete from public.login_throttle where key = 'phone:' || v_phone;
  perform public._audit('pin_reset', 'account', p->>'account_id',
    jsonb_build_object('temp_pin_expires_at', p->>'expires_at'), p->>'actor');
  return jsonb_build_object('ok', true, 'temp_pin_expires_at', p->>'expires_at');
end $$;

-- Link a registered account to a participant record (admin confirmation).
-- participant_id = null => create a new participant from the account's details.
create function public.admin_account_link(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare a public.participant_accounts; v_pid uuid := (p->>'participant_id')::uuid;
begin
  select * into a from public.participant_accounts where id = (p->>'account_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_pid is null then
    insert into public.participants (first_name, last_name, phone, email, created_via)
    values (a.first_name, a.last_name, a.phone, a.email, 'registration')
    returning id into v_pid;
  else
    if not exists (select 1 from public.participants where id = v_pid) then
      return jsonb_build_object('error', 'not_found');
    end if;
    if exists (select 1 from public.participant_accounts where participant_id = v_pid and id <> a.id) then
      return jsonb_build_object('error', 'participant_has_account');
    end if;
  end if;
  update public.participant_accounts set participant_id = v_pid, link_status = 'linked' where id = a.id;
  perform public._audit('account_link', 'account', a.id::text,
    jsonb_build_object('participant_id', v_pid), p->>'actor');
  return jsonb_build_object('ok', true, 'participant_id', v_pid);
end $$;

-- ===========================================================================
-- Admin: performances
-- ===========================================================================
create function public.admin_performances_list(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(public._perf_json(v) order by v.position) from public.performance_view v), '[]'::jsonb),
    'max_duration_seconds', (select max_duration_seconds from public.app_settings where id = 1));
$$;

create function public.admin_performance_get(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare v public.performance_view;
begin
  select * into v from public.performance_view where id = (p->>'id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object(
    'performance', public._perf_json(v),
    'same_song', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'display_name', o.display_name, 'side', o.side) order by o.position)
        from public.performance_view o
       where o.normalized_song_title = v.normalized_song_title and o.id <> v.id), '[]'::jsonb),
    'max_duration_seconds', (select max_duration_seconds from public.app_settings where id = 1));
end $$;

create function public.admin_performance_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_ids uuid[] := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p->'participant_ids', '[]'::jsonb)) x);
  v_type text := p->>'performance_type';
  v_status text := coalesce(p->>'preparation_status', 'draft');
  v_has_audio boolean := false;
  v_reasons text[] := '{}';
  cur public.performances;
  v public.performance_view;
begin
  if (select count(*) from public.participants where id = any(v_ids)) <> cardinality(v_ids) then
    return jsonb_build_object('error', 'invalid_participants');
  end if;
  if v_id is not null then
    select * into cur from public.performances where id = v_id for update;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    if p ? 'expected_version' and (p->>'expected_version')::int <> cur.version then
      return jsonb_build_object('error', 'conflict');
    end if;
    v_has_audio := cur.audio_storage_path is not null;
  end if;
  if v_type = 'solo' and cardinality(v_ids) > 1 then
    return jsonb_build_object('error', 'solo_one_participant');
  end if;
  if v_status = 'ready' then
    if not v_has_audio then v_reasons := array_append(v_reasons, 'audio'); end if;
    if cardinality(v_ids) = 0 then v_reasons := array_append(v_reasons, 'participants'); end if;
    if cardinality(v_reasons) > 0 then
      return jsonb_build_object('error', 'not_ready', 'missing', to_jsonb(v_reasons));
    end if;
  end if;

  if v_id is null then
    insert into public.performances (display_name, side, performance_type, song_title, normalized_song_title,
                                     artist, youtube_url, admin_notes, preparation_status, sort_order)
    values (btrim(p->>'display_name'), p->>'side', v_type, btrim(p->>'song_title'), p->>'normalized_song_title',
            public._nullif_blank(p->>'artist'), public._nullif_blank(p->>'youtube_url'),
            public._nullif_blank(p->>'admin_notes'), v_status,
            coalesce((select max(sort_order) from public.performances), 0) + 1)
    returning id into v_id;
    update public.app_state set order_revision = order_revision + 1 where id = 1;
  else
    update public.performances
       set display_name = btrim(p->>'display_name'), side = p->>'side', performance_type = v_type,
           song_title = btrim(p->>'song_title'), normalized_song_title = p->>'normalized_song_title',
           artist = public._nullif_blank(p->>'artist'), youtube_url = public._nullif_blank(p->>'youtube_url'),
           admin_notes = public._nullif_blank(p->>'admin_notes'), preparation_status = v_status,
           version = version + 1
     where id = v_id;
    delete from public.performance_participants where performance_id = v_id and participant_id <> all(v_ids);
  end if;
  insert into public.performance_participants (performance_id, participant_id)
  select v_id, x from unnest(v_ids) x
  on conflict do nothing;

  select * into v from public.performance_view where id = v_id;
  return jsonb_build_object('performance', public._perf_json(v));
end $$;

create function public.admin_performance_delete(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare cur public.performances; v_paths text[];
begin
  select * into cur from public.performances where id = (p->>'id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select array_agg(storage_path) into v_paths from public.audio_uploads where performance_id = cur.id;
  delete from public.performances where id = cur.id;
  update public.app_state set order_revision = order_revision + 1 where id = 1;
  perform public._audit('performance_delete', 'performance', cur.id::text,
    jsonb_build_object('display_name', cur.display_name, 'song_title', cur.song_title), p->>'actor');
  return jsonb_build_object('ok', true,
    'remove_paths', to_jsonb(array_remove(coalesce(v_paths, '{}') || cur.audio_storage_path, null)));
end $$;

create function public.admin_performance_set_duration(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.performance_view;
begin
  update public.performances set duration_seconds = (p->>'duration_seconds')::int, version = version + 1
   where id = (p->>'id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into v from public.performance_view where id = (p->>'id')::uuid;
  return jsonb_build_object('performance', public._perf_json(v));
end $$;

-- ===========================================================================
-- Admin: song library
-- ===========================================================================
create function public.admin_songs_list(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('songs', coalesce(jsonb_agg(s order by lower(s->>'title')), '[]'::jsonb))
  from (
    select jsonb_build_object(
             'key', normalized_song_title,
             'title', (array_agg(song_title order by created_at))[1],
             'count', count(*),
             'artists', coalesce(jsonb_agg(distinct artist) filter (where artist is not null), '[]'::jsonb),
             'sides', jsonb_agg(distinct side)) as s
      from public.performances
     group by normalized_song_title
  ) g;
$$;

create function public.admin_song_get(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'key', p->>'key',
    'items', coalesce(jsonb_agg(public._perf_json(v) order by v.position), '[]'::jsonb),
    'max_duration_seconds', (select max_duration_seconds from public.app_settings where id = 1))
  from public.performance_view v
  where v.normalized_song_title = p->>'key';
$$;

-- ===========================================================================
-- Running order & live mode
-- ===========================================================================
create function public.admin_running_order(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare st public.app_state;
begin
  select * into st from public.app_state where id = 1;
  if p ? 'known_version' and (p->>'known_version')::bigint = st.data_version then
    return jsonb_build_object('unchanged', true, 'data_version', st.data_version, 'order_revision', st.order_revision);
  end if;
  return jsonb_build_object(
    'unchanged', false,
    'data_version', st.data_version,
    'order_revision', st.order_revision,
    'max_duration_seconds', (select max_duration_seconds from public.app_settings where id = 1),
    'items', coalesce((select jsonb_agg(public._perf_json(v) order by v.position) from public.performance_view v), '[]'::jsonb));
end $$;

create function public.admin_reorder(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_ids uuid[] := array(select x::uuid from jsonb_array_elements_text(p->'ids') x);
  v_rev bigint;
begin
  select order_revision into v_rev from public.app_state where id = 1 for update;
  if v_rev <> (p->>'expected_revision')::bigint
     or (select count(*) from public.performances) <> cardinality(v_ids)
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids)
     or exists (select 1 from public.performances where id <> all(v_ids)) then
    return jsonb_build_object('error', 'conflict') || public.admin_running_order('{}'::jsonb);
  end if;
  update public.performances pf
     set sort_order = o.ord
    from unnest(v_ids) with ordinality as o(id, ord)
   where pf.id = o.id and pf.sort_order is distinct from o.ord;
  update public.app_state set order_revision = order_revision + 1, data_version = data_version + 1 where id = 1;
  return public.admin_running_order('{}'::jsonb);
end $$;

create function public.admin_set_live_status(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_status text := p->>'status'; cur public.performances; v public.performance_view;
begin
  if v_status not in ('pending', 'completed', 'skipped') then
    return jsonb_build_object('error', 'invalid_status');
  end if;
  select * into cur from public.performances where id = (p->>'id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if cur.live_status = v_status then
    null; -- idempotent: another device already made the same change
  elsif cur.version <> (p->>'expected_version')::int then
    select * into v from public.performance_view where id = cur.id;
    return jsonb_build_object('error', 'conflict', 'performance', public._perf_json(v));
  else
    update public.performances
       set live_status = v_status, live_status_changed_at = now(), version = version + 1
     where id = cur.id;
  end if;
  select * into v from public.performance_view where id = cur.id;
  return jsonb_build_object('performance', public._perf_json(v),
    'data_version', (select data_version from public.app_state where id = 1));
end $$;

-- ===========================================================================
-- Admin: audio upload lifecycle
-- ===========================================================================
create function public.admin_audio_upload_begin(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_id uuid; v_stale text[];
begin
  if not exists (select 1 from public.performances where id = (p->>'performance_id')::uuid) then
    return jsonb_build_object('error', 'not_found');
  end if;
  -- discard older unfinished uploads for this performance and anything abandoned > 3h ago
  with d as (
    delete from public.audio_uploads
     where performance_id = (p->>'performance_id')::uuid or created_at < now() - interval '3 hours'
    returning storage_path)
  select array_agg(storage_path) into v_stale from d;
  insert into public.audio_uploads (performance_id, storage_path, original_filename, mime_type, size_bytes)
  values ((p->>'performance_id')::uuid, p->>'storage_path', left(p->>'original_filename', 200),
          p->>'mime_type', (p->>'size_bytes')::bigint)
  returning id into v_id;
  return jsonb_build_object('upload_id', v_id, 'stale_paths', to_jsonb(coalesce(v_stale, '{}')));
end $$;

create function public.admin_audio_upload_get(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    (select to_jsonb(u) from public.audio_uploads u where u.id = (p->>'upload_id')::uuid),
    jsonb_build_object('error', 'not_found'));
$$;

create function public.admin_audio_upload_discard(p jsonb) returns jsonb
language sql set search_path = public as $$
  with d as (delete from public.audio_uploads where id = (p->>'upload_id')::uuid returning 1)
  select jsonb_build_object('ok', true);
$$;

create function public.admin_audio_finalize(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare u public.audio_uploads; v_old text; v public.performance_view;
begin
  select * into u from public.audio_uploads where id = (p->>'upload_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select audio_storage_path into v_old from public.performances where id = u.performance_id for update;
  update public.performances
     set audio_storage_path = u.storage_path, original_filename = u.original_filename,
         audio_mime_type = u.mime_type, audio_size_bytes = coalesce((p->>'size_bytes')::bigint, u.size_bytes),
         duration_seconds = coalesce((p->>'duration_seconds')::int, duration_seconds),
         audio_uploaded_at = now(), version = version + 1
   where id = u.performance_id;
  delete from public.audio_uploads where id = u.id;
  select * into v from public.performance_view where id = u.performance_id;
  return jsonb_build_object('performance', public._perf_json(v), 'old_path', v_old);
end $$;

create function public.admin_audio_remove(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_old text; v public.performance_view;
begin
  select audio_storage_path into v_old from public.performances where id = (p->>'performance_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update public.performances
     set audio_storage_path = null, original_filename = null, audio_mime_type = null, audio_size_bytes = null,
         audio_uploaded_at = null, preparation_status = 'draft', version = version + 1
   where id = (p->>'performance_id')::uuid;
  perform public._audit('audio_remove', 'performance', p->>'performance_id', '{}'::jsonb, p->>'actor');
  select * into v from public.performance_view where id = (p->>'performance_id')::uuid;
  return jsonb_build_object('performance', public._perf_json(v), 'old_path', v_old);
end $$;

-- ===========================================================================
-- Admin: settings & audit
-- ===========================================================================
create function public.admin_settings_get(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(s) - 'id' || jsonb_build_object('admin_username', (select username from public.admin_credentials where id = 1))
  from public.app_settings s where s.id = 1;
$$;

create function public.admin_settings_update(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  update public.app_settings
     set event_name = coalesce(btrim(p->>'event_name'), event_name),
         registration_enabled = coalesce((p->>'registration_enabled')::boolean, registration_enabled),
         max_duration_seconds = coalesce((p->>'max_duration_seconds')::int, max_duration_seconds),
         public_app_url = case when p ? 'public_app_url' then public._nullif_blank(p->>'public_app_url') else public_app_url end,
         updated_at = now()
   where id = 1;
  update public.app_state set data_version = data_version + 1 where id = 1;
  if p ? 'registration_enabled' then
    perform public._audit('settings_registration', 'settings', null,
      jsonb_build_object('registration_enabled', (p->>'registration_enabled')::boolean), p->>'actor');
  end if;
  return public.admin_settings_get('{}'::jsonb);
end $$;

create function public.admin_audit_list(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('entries', coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb))
  from (select * from public.admin_audit_log order by created_at desc limit 50) l;
$$;

-- ===========================================================================
-- Privileges: nothing for anon/authenticated; everything for service_role.
-- ===========================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
