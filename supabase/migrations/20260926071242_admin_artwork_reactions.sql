create function private.get_admin_artwork_reactions(target_kind text, target_id bigint)
returns table (
  display_name text,
  reacted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  case target_kind
    when 'feed-post' then
      return query
      select profile.display_name, reaction.created_at
      from public.feed_likes reaction
      join public.profiles profile on profile.user_id = reaction.user_id
      where reaction.post_id = target_id
      order by reaction.created_at, profile.display_name;
    when 'weekly-entry' then
      return query
      select profile.display_name, reaction.created_at
      from public.weekly_votes reaction
      join public.profiles profile on profile.user_id = reaction.voter_user_id
      where reaction.entry_id = target_id
      order by reaction.created_at, profile.display_name;
    when 'monthly-entry' then
      return query
      select profile.display_name, reaction.created_at
      from public.monthly_votes reaction
      join public.profiles profile on profile.user_id = reaction.voter_user_id
      where reaction.entry_id = target_id
      order by reaction.created_at, profile.display_name;
    else
      raise exception using errcode = 'P0001', message = 'MODERATION_KIND_INVALID';
  end case;
end;
$$;

create function public.get_admin_artwork_reactions(target_kind text, target_id bigint)
returns table (
  display_name text,
  reacted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_admin_artwork_reactions(target_kind, target_id)
$$;

revoke all on function private.get_admin_artwork_reactions(text, bigint) from public, anon;
grant execute on function private.get_admin_artwork_reactions(text, bigint) to authenticated;
revoke all on function public.get_admin_artwork_reactions(text, bigint) from public, anon;
grant execute on function public.get_admin_artwork_reactions(text, bigint) to authenticated;

comment on function public.get_admin_artwork_reactions(text, bigint) is
  'Returns display names and timestamps for an artwork reaction list after server-side admin authorization.';
