alter table public.feed_posts
  drop constraint if exists feed_posts_one_per_day;

create index if not exists feed_posts_user_date_idx
  on public.feed_posts (user_id, post_date, updated_at desc, id desc);

drop function public.get_daily_feed_account_state();
drop function private.get_daily_feed_account_state();

create function private.get_daily_feed_account_state()
returns table (
  profile_name text,
  post_id bigint,
  post_pixels jsonb,
  post_date date,
  received_like_count integer,
  today_post_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  today date := (timezone('Europe/Budapest', clock_timestamp()))::date;
begin
  return query
  select
    profile.display_name,
    latest_post.id,
    latest_post.pixels,
    latest_post.post_date,
    (select count(*)::integer
      from public.feed_likes own_like
      join public.feed_posts own_post on own_post.id = own_like.post_id
      where own_post.user_id = current_user_id),
    (select count(*)::integer
      from public.feed_posts today_post
      where today_post.user_id = current_user_id and today_post.post_date = today)
  from public.profiles profile
  left join lateral (
    select post.id, post.pixels, post.post_date
    from public.feed_posts post
    where post.user_id = current_user_id and post.post_date = today
    order by post.updated_at desc, post.id desc
    limit 1
  ) latest_post on true
  where profile.user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
end;
$$;

create function public.get_daily_feed_account_state()
returns table (
  profile_name text,
  post_id bigint,
  post_pixels jsonb,
  post_date date,
  received_like_count integer,
  today_post_count integer
)
language sql
security invoker
set search_path = ''
as $$ select * from private.get_daily_feed_account_state() $$;

revoke all on function private.get_daily_feed_account_state() from public, anon;
grant execute on function private.get_daily_feed_account_state() to authenticated;
revoke all on function public.get_daily_feed_account_state() from public, anon;
grant execute on function public.get_daily_feed_account_state() to authenticated;

drop function public.publish_daily_feed_post(jsonb);
drop function private.publish_daily_feed_post(jsonb);

create function private.publish_daily_feed_post(drawing_pixels jsonb, target_post_id bigint)
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || today::text, 0)
  );

  if target_post_id is not null then
    update public.feed_posts post
    set pixels = drawing_pixels, updated_at = clock_timestamp()
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

  insert into public.feed_posts (user_id, post_date, pixels)
  values (current_user_id, today, drawing_pixels)
  returning id into saved_post_id;

  return saved_post_id;
end;
$$;

create function public.publish_daily_feed_post(drawing_pixels jsonb, target_post_id bigint default null)
returns bigint
language sql
security invoker
set search_path = ''
as $$ select private.publish_daily_feed_post(drawing_pixels, target_post_id) $$;

revoke all on function private.publish_daily_feed_post(jsonb, bigint) from public, anon;
grant execute on function private.publish_daily_feed_post(jsonb, bigint) to authenticated;
revoke all on function public.publish_daily_feed_post(jsonb, bigint) from public, anon;
grant execute on function public.publish_daily_feed_post(jsonb, bigint) to authenticated;

create function private.delete_own_daily_feed_post(target_post_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  deleted_post_id bigint;
begin
  delete from public.feed_posts post
  where post.id = target_post_id
    and post.user_id = current_user_id
  returning post.id into deleted_post_id;

  if deleted_post_id is null then
    raise exception using errcode = 'P0001', message = 'FEED_POST_NOT_OWN';
  end if;

  return true;
end;
$$;

create function public.delete_own_daily_feed_post(target_post_id bigint)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.delete_own_daily_feed_post(target_post_id) $$;

revoke all on function private.delete_own_daily_feed_post(bigint) from public, anon;
grant execute on function private.delete_own_daily_feed_post(bigint) to authenticated;

revoke all on function public.delete_own_daily_feed_post(bigint) from public, anon;
grant execute on function public.delete_own_daily_feed_post(bigint) to authenticated;
