create or replace function private.get_monthly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  updated_at timestamptz, vote_count bigint, has_voted boolean,
  is_own boolean, is_winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with challenge as (
    select c.ends_at
    from public.monthly_challenges c
    where c.id = target_challenge_id
  ), entries_with_votes as (
    select e.id, e.user_id, e.pixels, e.updated_at, p.display_name, p.avatar_pixels,
      count(v.entry_id)::bigint as votes
    from public.monthly_entries e
    join public.profiles p on p.user_id = e.user_id
    left join public.monthly_votes v on v.entry_id = e.id
    cross join challenge c
    where e.challenge_id = target_challenge_id
      and e.submitted_at is not null
      and e.excluded_at is null
    group by e.id, e.user_id, e.pixels, e.updated_at, p.display_name, p.avatar_pixels
  ), totals as (
    select coalesce(max(votes), 0) as top_votes from entries_with_votes
  )
  select e.id, e.display_name, e.avatar_pixels, e.pixels, e.updated_at, e.votes,
    exists (select 1 from public.monthly_votes v where v.entry_id = e.id and v.voter_user_id = auth.uid()),
    e.user_id = auth.uid(),
    clock_timestamp() >= c.ends_at and e.votes = t.top_votes
  from entries_with_votes e cross join totals t cross join challenge c;
$$;

create or replace function private.get_monthly_gallery_page(
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
    select monthly_challenge.ends_at
    from public.monthly_challenges monthly_challenge
    where monthly_challenge.id = target_challenge_id
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
