create function private.moderate_delete_lobby_message(target_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id bigint;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  delete from public.lobby_messages message
  where message.id = target_message_id
  returning message.id into affected_id;

  if affected_id is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
  end if;

  return true;
end;
$$;

create function public.moderate_delete_lobby_message(target_message_id bigint)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.moderate_delete_lobby_message(target_message_id) $$;

revoke all on function private.moderate_delete_lobby_message(bigint) from public, anon;
grant execute on function private.moderate_delete_lobby_message(bigint) to authenticated;
revoke all on function public.moderate_delete_lobby_message(bigint) from public, anon;
grant execute on function public.moderate_delete_lobby_message(bigint) to authenticated;

comment on function public.moderate_delete_lobby_message(bigint) is
  'Permanently deletes one global lobby chat message after server-side admin authorization.';
