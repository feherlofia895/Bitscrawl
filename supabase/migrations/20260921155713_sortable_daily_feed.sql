create function private.get_daily_feed_page(
  requested_limit integer,
  requested_offset integer,
  requested_sort text,
  discovery_seed integer
)
returns table (
  post_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  description text,
  post_date date,
  created_at timestamptz,
  updated_at timestamptz,
  like_count integer,
  comment_count integer,
  author_received_likes integer,
  has_liked boolean,
  is_own boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := case
    when auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean, true)
      then auth.uid()
    else null
  end;
  safe_limit integer := least(greatest(coalesce(requested_limit, 6), 1), 6);
  safe_offset integer := greatest(coalesce(requested_offset, 0), 0);
  safe_sort text := coalesce(requested_sort, 'newest');
  safe_seed integer := coalesce(discovery_seed, 0);
begin
  if safe_sort not in ('newest', 'likes', 'discovery') then
    raise exception using errcode = 'P0001', message = 'FEED_SORT_INVALID';
  end if;

  return query
  with feed_rows as (
    select
      post.id as row_post_id,
      profile.display_name as row_author_name,
      profile.avatar_pixels as row_author_avatar,
      post.pixels as row_pixels,
      post.description as row_description,
      post.post_date as row_post_date,
      post.created_at as row_created_at,
      post.updated_at as row_updated_at,
      (select count(*)::integer from public.feed_likes like_row where like_row.post_id = post.id) as row_like_count,
      (select count(*)::integer from public.feed_comments comment_row where comment_row.post_id = post.id) as row_comment_count,
      (select count(*)::integer
        from public.feed_likes author_like
        join public.feed_posts author_post on author_post.id = author_like.post_id
        where author_post.user_id = post.user_id) as row_author_received_likes,
      exists (
        select 1 from public.feed_likes own_like
        where own_like.post_id = post.id and own_like.user_id = current_user_id
      ) as row_has_liked,
      post.user_id = current_user_id as row_is_own,
      count(*) over () as row_total_count
    from public.feed_posts post
    join public.profiles profile on profile.user_id = post.user_id
  )
  select
    row_post_id,
    row_author_name,
    row_author_avatar,
    row_pixels,
    row_description,
    row_post_date,
    row_created_at,
    row_updated_at,
    row_like_count,
    row_comment_count,
    row_author_received_likes,
    row_has_liked,
    row_is_own,
    row_total_count
  from feed_rows
  order by
    case when safe_sort = 'likes' then row_like_count end desc,
    case when safe_sort = 'newest' then row_created_at end desc,
    case when safe_sort = 'discovery' then md5(row_post_id::text || ':' || safe_seed::text) end,
    row_post_id desc
  limit safe_limit offset safe_offset;
end;
$$;

create function public.get_daily_feed_page(
  requested_limit integer default 6,
  requested_offset integer default 0,
  requested_sort text default 'newest',
  discovery_seed integer default 0
)
returns table (
  post_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  description text,
  post_date date,
  created_at timestamptz,
  updated_at timestamptz,
  like_count integer,
  comment_count integer,
  author_received_likes integer,
  has_liked boolean,
  is_own boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_daily_feed_page(requested_limit, requested_offset, requested_sort, discovery_seed)
$$;

revoke all on function private.get_daily_feed_page(integer, integer, text, integer) from public;
grant execute on function private.get_daily_feed_page(integer, integer, text, integer) to anon, authenticated;
revoke all on function public.get_daily_feed_page(integer, integer, text, integer) from public;
grant execute on function public.get_daily_feed_page(integer, integer, text, integer) to anon, authenticated;
