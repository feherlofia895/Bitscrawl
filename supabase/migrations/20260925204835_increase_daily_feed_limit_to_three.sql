create or replace function private.publish_daily_feed_post(
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
    returning post.id into saved_post_id;

    if saved_post_id is null then
      raise exception using errcode = 'P0001', message = 'FEED_POST_NOT_OWN';
    end if;
    return saved_post_id;
  end if;

  select count(*)::integer into active_post_count
  from public.feed_posts post
  where post.user_id = current_user_id and post.post_date = today;

  if active_post_count >= 3 then
    raise exception using errcode = 'P0001', message = 'FEED_DAILY_LIMIT';
  end if;

  insert into public.feed_posts (user_id, post_date, pixels, description)
  values (current_user_id, today, drawing_pixels, clean_description)
  returning id into saved_post_id;

  return saved_post_id;
end;
$$;
