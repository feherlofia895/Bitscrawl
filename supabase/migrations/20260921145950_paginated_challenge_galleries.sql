create function private.get_weekly_gallery_page(
  target_challenge_id bigint,
  requested_sort text,
  discovery_seed bigint,
  requested_limit integer,
  requested_offset integer
)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  submitted_at timestamptz,
  vote_count bigint,
  comment_count integer,
  has_voted boolean,
  is_own boolean,
  is_winner boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_sort text := coalesce(requested_sort, 'likes');
  safe_seed bigint := coalesce(discovery_seed, 0);
  safe_limit integer := least(greatest(coalesce(requested_limit, 6), 1), 6);
  safe_offset integer := greatest(coalesce(requested_offset, 0), 0);
begin
  if safe_sort not in ('likes', 'discovery', 'newest') then
    raise exception using errcode = 'P0001', message = 'GALLERY_SORT_INVALID';
  end if;

  return query
  with challenge as (
    select weekly_challenge.ends_at
    from public.weekly_challenges weekly_challenge
    where weekly_challenge.id = target_challenge_id
  ), entries_with_votes as (
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.weekly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.weekly_votes vote on vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels
  ), prepared as (
    select
      entry.*,
      max(entry.votes) over () as top_votes,
      count(*) over () as all_entries
    from entries_with_votes entry
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.submitted_at,
    entry.votes,
    (
      select count(*)::integer
      from public.gallery_comments comment_row
      where comment_row.weekly_entry_id = entry.id
    ),
    exists (
      select 1
      from public.weekly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    clock_timestamp() >= challenge.ends_at and entry.votes = entry.top_votes,
    entry.all_entries
  from prepared entry
  cross join challenge
  order by
    case when safe_sort = 'likes' then entry.votes end desc,
    case when safe_sort = 'likes' then entry.submitted_at end desc,
    case when safe_sort = 'newest' then entry.submitted_at end desc,
    case when safe_sort = 'discovery' then md5(entry.id::text || ':' || safe_seed::text) end,
    entry.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

create function public.get_weekly_gallery_page(
  target_challenge_id bigint,
  requested_sort text default 'likes',
  discovery_seed bigint default 0,
  requested_limit integer default 6,
  requested_offset integer default 0
)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  submitted_at timestamptz,
  vote_count bigint,
  comment_count integer,
  has_voted boolean,
  is_own boolean,
  is_winner boolean,
  total_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.get_weekly_gallery_page(
    target_challenge_id,
    requested_sort,
    discovery_seed,
    requested_limit,
    requested_offset
  )
$$;

create function private.get_monthly_gallery_page(
  target_challenge_id bigint,
  requested_sort text,
  discovery_seed bigint,
  requested_limit integer,
  requested_offset integer
)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  updated_at timestamptz,
  vote_count bigint,
  comment_count integer,
  has_voted boolean,
  is_own boolean,
  is_winner boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_sort text := coalesce(requested_sort, 'likes');
  safe_seed bigint := coalesce(discovery_seed, 0);
  safe_limit integer := least(greatest(coalesce(requested_limit, 6), 1), 6);
  safe_offset integer := greatest(coalesce(requested_offset, 0), 0);
begin
  if safe_sort not in ('likes', 'discovery', 'newest') then
    raise exception using errcode = 'P0001', message = 'GALLERY_SORT_INVALID';
  end if;

  return query
  with challenge as (
    select monthly_challenge.ends_at, monthly_challenge.voting_starts_at
    from public.monthly_challenges monthly_challenge
    where monthly_challenge.id = target_challenge_id
      and clock_timestamp() >= monthly_challenge.voting_starts_at
  ), entries_with_votes as (
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.monthly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.monthly_votes vote on vote.entry_id = entry.id
    cross join challenge
    where entry.challenge_id = target_challenge_id
      and entry.submitted_at is not null
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels
  ), prepared as (
    select
      entry.*,
      max(entry.votes) over () as top_votes,
      count(*) over () as all_entries
    from entries_with_votes entry
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.updated_at,
    entry.votes,
    (
      select count(*)::integer
      from public.gallery_comments comment_row
      where comment_row.monthly_entry_id = entry.id
    ),
    exists (
      select 1
      from public.monthly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    clock_timestamp() >= challenge.ends_at and entry.votes = entry.top_votes,
    entry.all_entries
  from prepared entry
  cross join challenge
  order by
    case when safe_sort = 'likes' then entry.votes end desc,
    case when safe_sort = 'likes' then entry.updated_at end desc,
    case when safe_sort = 'newest' then entry.updated_at end desc,
    case when safe_sort = 'discovery' then md5(entry.id::text || ':' || safe_seed::text) end,
    entry.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

create function public.get_monthly_gallery_page(
  target_challenge_id bigint,
  requested_sort text default 'likes',
  discovery_seed bigint default 0,
  requested_limit integer default 6,
  requested_offset integer default 0
)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  updated_at timestamptz,
  vote_count bigint,
  comment_count integer,
  has_voted boolean,
  is_own boolean,
  is_winner boolean,
  total_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.get_monthly_gallery_page(
    target_challenge_id,
    requested_sort,
    discovery_seed,
    requested_limit,
    requested_offset
  )
$$;

create function private.get_gallery_comments_for_entry(
  target_kind text,
  target_entry_id bigint,
  requested_limit integer,
  requested_offset integer
)
returns table (
  comment_id bigint,
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  content text,
  created_at timestamptz,
  is_own boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 20);
  safe_offset integer := greatest(coalesce(requested_offset, 0), 0);
begin
  if target_kind = 'weekly' then
    return query
    select
      comment_row.id,
      entry.id,
      profile.display_name,
      profile.avatar_pixels,
      comment_row.content,
      comment_row.created_at,
      comment_row.user_id = auth.uid(),
      count(*) over ()
    from public.gallery_comments comment_row
    join public.weekly_entries entry on entry.id = comment_row.weekly_entry_id
    join public.profiles profile on profile.user_id = comment_row.user_id
    where entry.id = target_entry_id
      and entry.excluded_at is null
    order by comment_row.created_at desc, comment_row.id desc
    limit safe_limit
    offset safe_offset;
  elsif target_kind = 'monthly' then
    return query
    select
      comment_row.id,
      entry.id,
      profile.display_name,
      profile.avatar_pixels,
      comment_row.content,
      comment_row.created_at,
      comment_row.user_id = auth.uid(),
      count(*) over ()
    from public.gallery_comments comment_row
    join public.monthly_entries entry on entry.id = comment_row.monthly_entry_id
    join public.monthly_challenges challenge on challenge.id = entry.challenge_id
    join public.profiles profile on profile.user_id = comment_row.user_id
    where entry.id = target_entry_id
      and entry.submitted_at is not null
      and entry.excluded_at is null
      and clock_timestamp() >= challenge.voting_starts_at
    order by comment_row.created_at desc, comment_row.id desc
    limit safe_limit
    offset safe_offset;
  else
    raise exception using errcode = 'P0001', message = 'GALLERY_KIND_INVALID';
  end if;
end;
$$;

create function public.get_gallery_comments_for_entry(
  target_kind text,
  target_entry_id bigint,
  requested_limit integer default 20,
  requested_offset integer default 0
)
returns table (
  comment_id bigint,
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  content text,
  created_at timestamptz,
  is_own boolean,
  total_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.get_gallery_comments_for_entry(
    target_kind,
    target_entry_id,
    requested_limit,
    requested_offset
  )
$$;

revoke all on function private.get_weekly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function private.get_weekly_gallery_page(bigint, text, bigint, integer, integer) to anon, authenticated;
revoke all on function public.get_weekly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function public.get_weekly_gallery_page(bigint, text, bigint, integer, integer) to anon, authenticated;

revoke all on function private.get_monthly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function private.get_monthly_gallery_page(bigint, text, bigint, integer, integer) to anon, authenticated;
revoke all on function public.get_monthly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function public.get_monthly_gallery_page(bigint, text, bigint, integer, integer) to anon, authenticated;

revoke all on function private.get_gallery_comments_for_entry(text, bigint, integer, integer) from public;
grant execute on function private.get_gallery_comments_for_entry(text, bigint, integer, integer) to anon, authenticated;
revoke all on function public.get_gallery_comments_for_entry(text, bigint, integer, integer) from public;
grant execute on function public.get_gallery_comments_for_entry(text, bigint, integer, integer) to anon, authenticated;
