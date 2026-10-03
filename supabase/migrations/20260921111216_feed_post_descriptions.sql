alter table public.feed_posts
  add column description text not null default '',
  add constraint feed_posts_description_valid check (
    description = btrim(description)
    and char_length(description) <= 160
    and char_length(description) - char_length(replace(description, E'\n', '')) <= 2
    and strpos(description, E'\r') = 0
  );

drop function public.get_daily_feed(integer, integer);
drop function private.get_daily_feed(integer, integer);

create function private.get_daily_feed(requested_limit integer, requested_offset integer)
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
begin
  return query
  select
    post.id,
    profile.display_name,
    profile.avatar_pixels,
    post.pixels,
    post.description,
    post.post_date,
    post.created_at,
    post.updated_at,
    (select count(*)::integer from public.feed_likes like_row where like_row.post_id = post.id),
    (select count(*)::integer from public.feed_comments comment_row where comment_row.post_id = post.id),
    (select count(*)::integer
      from public.feed_likes author_like
      join public.feed_posts author_post on author_post.id = author_like.post_id
      where author_post.user_id = post.user_id),
    exists (
      select 1 from public.feed_likes own_like
      where own_like.post_id = post.id and own_like.user_id = current_user_id
    ),
    post.user_id = current_user_id,
    count(*) over ()
  from public.feed_posts post
  join public.profiles profile on profile.user_id = post.user_id
  order by post.created_at desc, post.id desc
  limit safe_limit offset safe_offset;
end;
$$;

create function public.get_daily_feed(requested_limit integer default 6, requested_offset integer default 0)
returns table (
  post_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  description text, post_date date, created_at timestamptz, updated_at timestamptz,
  like_count integer, comment_count integer, author_received_likes integer,
  has_liked boolean, is_own boolean, total_count bigint
)
language sql
security invoker
set search_path = ''
as $$ select * from private.get_daily_feed(requested_limit, requested_offset) $$;

revoke all on function private.get_daily_feed(integer, integer) from public;
grant execute on function private.get_daily_feed(integer, integer) to anon, authenticated;
revoke all on function public.get_daily_feed(integer, integer) from public;
grant execute on function public.get_daily_feed(integer, integer) to anon, authenticated;

drop function public.publish_daily_feed_post(jsonb, bigint);
drop function private.publish_daily_feed_post(jsonb, bigint);

create function private.publish_daily_feed_post(
  drawing_pixels jsonb,
  target_post_id bigint,
  requested_description text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  today date := (timezone('Europe/Budapest', clock_timestamp()))::date;
  saved_post_id bigint;
  active_post_count integer;
  clean_description text := btrim(replace(replace(coalesce(requested_description, ''), E'\r\n', E'\n'), E'\r', E'\n'));
begin
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if not private.feed_pixels_valid(drawing_pixels)
    or not exists (
      select 1 from jsonb_array_elements_text(drawing_pixels) as pixel(value)
      where pixel.value <> 'transparent'
    )
  then
    raise exception using errcode = 'P0001', message = 'FEED_DRAWING_INVALID';
  end if;
  if char_length(clean_description) > 160
    or char_length(clean_description) - char_length(replace(clean_description, E'\n', '')) > 2
  then
    raise exception using errcode = 'P0001', message = 'FEED_DESCRIPTION_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || today::text, 0)
  );

  if target_post_id is not null then
    update public.feed_posts post
    set pixels = drawing_pixels, description = clean_description, updated_at = clock_timestamp()
    where post.id = target_post_id
      and post.user_id = current_user_id
      and post.post_date = today
    returning post.id into saved_post_id;

    if saved_post_id is null then
      raise exception using errcode = 'P0001', message = 'FEED_POST_NOT_OWN';
    end if;
    return saved_post_id;
  end if;

  select count(*)::integer into active_post_count
  from public.feed_posts post
  where post.user_id = current_user_id and post.post_date = today;

  if active_post_count >= 2 then
    raise exception using errcode = 'P0001', message = 'FEED_DAILY_LIMIT';
  end if;

  insert into public.feed_posts (user_id, post_date, pixels, description)
  values (current_user_id, today, drawing_pixels, clean_description)
  returning id into saved_post_id;

  return saved_post_id;
end;
$$;

create function public.publish_daily_feed_post(
  drawing_pixels jsonb,
  target_post_id bigint default null,
  requested_description text default ''
)
returns bigint
language sql
security invoker
set search_path = ''
as $$ select private.publish_daily_feed_post(drawing_pixels, target_post_id, requested_description) $$;

revoke all on function private.publish_daily_feed_post(jsonb, bigint, text) from public, anon;
grant execute on function private.publish_daily_feed_post(jsonb, bigint, text) to authenticated;
revoke all on function public.publish_daily_feed_post(jsonb, bigint, text) from public, anon;
grant execute on function public.publish_daily_feed_post(jsonb, bigint, text) to authenticated;
