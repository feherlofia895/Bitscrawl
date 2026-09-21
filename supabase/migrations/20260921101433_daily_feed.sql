create function private.feed_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate is null or jsonb_typeof(candidate) <> 'array' then false
    else jsonb_array_length(candidate) = 1024
      and not exists (
        select 1
        from jsonb_array_elements(candidate) as pixel(value)
        where jsonb_typeof(pixel.value) <> 'string'
          or (pixel.value #>> '{}') not in (
            'transparent',
            '#f7f3e8', '#d8cfbd', '#999ea1', '#66707a', '#3f4650', '#242630', '#230a19', '#0f111a',
            '#7d2d3b', '#d3493b', '#f25c54', '#da7149', '#e29958', '#f2b35d', '#f5e57a', '#fff1a8',
            '#4d5b32', '#718441', '#a5d967', '#d4eb7a', '#2e6b4f', '#67ba62', '#549d8c', '#79cbb8',
            '#1e4957', '#347f8c', '#33567e', '#4b79b8', '#221a5f', '#51439a', '#8d5a9f', '#c57ca8'
          )
      )
  end;
$$;

create table public.feed_posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  post_date date not null default (timezone('Europe/Budapest', clock_timestamp()))::date,
  pixels jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint feed_posts_one_per_day unique (user_id, post_date),
  constraint feed_posts_pixels_valid check (private.feed_pixels_valid(pixels)),
  constraint feed_posts_not_empty check (pixels <> to_jsonb(array_fill('transparent'::text, array[1024])))
);

create index feed_posts_newest_idx on public.feed_posts (created_at desc, id desc);
create index feed_posts_user_idx on public.feed_posts (user_id, created_at desc);

create table public.feed_likes (
  post_id bigint not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (post_id, user_id)
);

create index feed_likes_user_idx on public.feed_likes (user_id, created_at desc);

create table public.feed_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  content text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint feed_comments_content check (
    content = btrim(content) and char_length(content) between 1 and 280
  )
);

create index feed_comments_post_idx on public.feed_comments (post_id, created_at, id);
create index feed_comments_user_idx on public.feed_comments (user_id, created_at desc);

alter table public.feed_posts enable row level security;
alter table public.feed_likes enable row level security;
alter table public.feed_comments enable row level security;

revoke all on public.feed_posts, public.feed_likes, public.feed_comments from public, anon, authenticated;

create function private.get_daily_feed(requested_limit integer, requested_offset integer)
returns table (
  post_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
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

create function private.get_daily_feed_account_state()
returns table (
  profile_name text,
  post_id bigint,
  post_pixels jsonb,
  post_date date,
  received_like_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  return query
  select
    profile.display_name,
    post.id,
    post.pixels,
    post.post_date,
    (select count(*)::integer
      from public.feed_likes own_like
      join public.feed_posts own_post on own_post.id = own_like.post_id
      where own_post.user_id = current_user_id)
  from public.profiles profile
  left join public.feed_posts post
    on post.user_id = profile.user_id
   and post.post_date = (timezone('Europe/Budapest', clock_timestamp()))::date
  where profile.user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
end;
$$;

create function private.publish_daily_feed_post(drawing_pixels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  today date := (timezone('Europe/Budapest', clock_timestamp()))::date;
  saved_post_id bigint;
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

  insert into public.feed_posts (user_id, post_date, pixels)
  values (current_user_id, today, drawing_pixels)
  on conflict (user_id, post_date) do update
    set pixels = excluded.pixels, updated_at = clock_timestamp()
  returning id into saved_post_id;

  return saved_post_id;
end;
$$;

create function private.set_daily_feed_like(target_post_id bigint, like_enabled boolean)
returns table (liked boolean, active_like_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  post_owner_id uuid;
begin
  select post.user_id into post_owner_id
  from public.feed_posts post
  where post.id = target_post_id;

  if post_owner_id is null then
    raise exception using errcode = 'P0001', message = 'FEED_POST_NOT_FOUND';
  end if;
  if post_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'FEED_OWN_LIKE_FORBIDDEN';
  end if;

  if like_enabled then
    insert into public.feed_likes (post_id, user_id)
    values (target_post_id, current_user_id)
    on conflict do nothing;
  else
    delete from public.feed_likes like_row
    where like_row.post_id = target_post_id and like_row.user_id = current_user_id;
  end if;

  return query
  select
    exists (
      select 1 from public.feed_likes own_like
      where own_like.post_id = target_post_id and own_like.user_id = current_user_id
    ),
    (select count(*)::integer from public.feed_likes like_row where like_row.post_id = target_post_id);
end;
$$;

create function private.get_daily_feed_comments(target_post_ids bigint[])
returns table (
  comment_id bigint,
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  content text,
  created_at timestamptz,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(target_post_ids), 0) > 6 then
    raise exception using errcode = 'P0001', message = 'FEED_PAGE_INVALID';
  end if;

  return query
  select comment.id, comment.post_id, profile.display_name, profile.avatar_pixels,
    comment.content, comment.created_at, comment.user_id = auth.uid()
  from public.feed_comments comment
  join public.profiles profile on profile.user_id = comment.user_id
  where comment.post_id = any(coalesce(target_post_ids, array[]::bigint[]))
  order by comment.created_at, comment.id;
end;
$$;

create function private.add_daily_feed_comment(target_post_id bigint, requested_content text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_content text := regexp_replace(btrim(coalesce(requested_content, '')), '[[:space:]]+', ' ', 'g');
  saved_comment_id bigint;
begin
  if char_length(clean_content) not between 1 and 280 then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_INVALID';
  end if;
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if not exists (select 1 from public.feed_posts post where post.id = target_post_id) then
    raise exception using errcode = 'P0001', message = 'FEED_POST_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.feed_comments recent
    where recent.user_id = current_user_id
      and recent.created_at > clock_timestamp() - interval '2 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_RATE_LIMIT';
  end if;

  insert into public.feed_comments (post_id, user_id, content)
  values (target_post_id, current_user_id, clean_content)
  returning id into saved_comment_id;
  return saved_comment_id;
end;
$$;

create function private.update_daily_feed_comment(target_comment_id bigint, requested_content text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_content text := regexp_replace(btrim(coalesce(requested_content, '')), '[[:space:]]+', ' ', 'g');
  saved_content text;
begin
  if char_length(clean_content) not between 1 and 280 then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_INVALID';
  end if;

  update public.feed_comments comment
  set content = clean_content, updated_at = clock_timestamp()
  where comment.id = target_comment_id and comment.user_id = current_user_id
  returning comment.content into saved_content;

  if saved_content is null then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_NOT_OWN';
  end if;
  return saved_content;
end;
$$;

create function private.get_own_feed_stats()
returns table (post_count integer, received_like_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  return query
  select
    (select count(*)::integer from public.feed_posts post where post.user_id = current_user_id),
    (select count(*)::integer
      from public.feed_likes own_like
      join public.feed_posts own_post on own_post.id = own_like.post_id
      where own_post.user_id = current_user_id);
end;
$$;

create function public.get_daily_feed(requested_limit integer default 6, requested_offset integer default 0)
returns table (
  post_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  post_date date, created_at timestamptz, updated_at timestamptz,
  like_count integer, comment_count integer, author_received_likes integer,
  has_liked boolean, is_own boolean, total_count bigint
)
language sql security invoker set search_path = ''
as $$ select * from private.get_daily_feed(requested_limit, requested_offset) $$;

create function public.get_daily_feed_account_state()
returns table (
  profile_name text, post_id bigint, post_pixels jsonb,
  post_date date, received_like_count integer
)
language sql security invoker set search_path = ''
as $$ select * from private.get_daily_feed_account_state() $$;

create function public.publish_daily_feed_post(drawing_pixels jsonb)
returns bigint language sql security invoker set search_path = ''
as $$ select private.publish_daily_feed_post(drawing_pixels) $$;

create function public.set_daily_feed_like(target_post_id bigint, like_enabled boolean)
returns table (liked boolean, active_like_count integer)
language sql security invoker set search_path = ''
as $$ select * from private.set_daily_feed_like(target_post_id, like_enabled) $$;

create function public.get_daily_feed_comments(target_post_ids bigint[])
returns table (
  comment_id bigint, entry_id bigint, author_name text, author_avatar jsonb,
  content text, created_at timestamptz, is_own boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.get_daily_feed_comments(target_post_ids) $$;

create function public.add_daily_feed_comment(target_post_id bigint, requested_content text)
returns bigint language sql security invoker set search_path = ''
as $$ select private.add_daily_feed_comment(target_post_id, requested_content) $$;

create function public.update_daily_feed_comment(target_comment_id bigint, requested_content text)
returns text language sql security invoker set search_path = ''
as $$ select private.update_daily_feed_comment(target_comment_id, requested_content) $$;

create function public.get_own_feed_stats()
returns table (post_count integer, received_like_count integer)
language sql security invoker set search_path = ''
as $$ select * from private.get_own_feed_stats() $$;

revoke all on function private.feed_pixels_valid(jsonb) from public, anon, authenticated;

revoke all on function private.get_daily_feed(integer, integer) from public;
revoke all on function private.get_daily_feed_account_state() from public, anon;
revoke all on function private.publish_daily_feed_post(jsonb) from public, anon;
revoke all on function private.set_daily_feed_like(bigint, boolean) from public, anon;
revoke all on function private.get_daily_feed_comments(bigint[]) from public;
revoke all on function private.add_daily_feed_comment(bigint, text) from public, anon;
revoke all on function private.update_daily_feed_comment(bigint, text) from public, anon;
revoke all on function private.get_own_feed_stats() from public, anon;

grant execute on function private.get_daily_feed(integer, integer) to anon, authenticated;
grant execute on function private.get_daily_feed_account_state() to authenticated;
grant execute on function private.publish_daily_feed_post(jsonb) to authenticated;
grant execute on function private.set_daily_feed_like(bigint, boolean) to authenticated;
grant execute on function private.get_daily_feed_comments(bigint[]) to anon, authenticated;
grant execute on function private.add_daily_feed_comment(bigint, text) to authenticated;
grant execute on function private.update_daily_feed_comment(bigint, text) to authenticated;
grant execute on function private.get_own_feed_stats() to authenticated;

revoke all on function public.get_daily_feed(integer, integer) from public;
revoke all on function public.get_daily_feed_account_state() from public, anon;
revoke all on function public.publish_daily_feed_post(jsonb) from public, anon;
revoke all on function public.set_daily_feed_like(bigint, boolean) from public, anon;
revoke all on function public.get_daily_feed_comments(bigint[]) from public;
revoke all on function public.add_daily_feed_comment(bigint, text) from public, anon;
revoke all on function public.update_daily_feed_comment(bigint, text) from public, anon;
revoke all on function public.get_own_feed_stats() from public, anon;

grant execute on function public.get_daily_feed(integer, integer) to anon, authenticated;
grant execute on function public.get_daily_feed_account_state() to authenticated;
grant execute on function public.publish_daily_feed_post(jsonb) to authenticated;
grant execute on function public.set_daily_feed_like(bigint, boolean) to authenticated;
grant execute on function public.get_daily_feed_comments(bigint[]) to anon, authenticated;
grant execute on function public.add_daily_feed_comment(bigint, text) to authenticated;
grant execute on function public.update_daily_feed_comment(bigint, text) to authenticated;
grant execute on function public.get_own_feed_stats() to authenticated;

comment on table public.feed_posts is 'One editable 32x32 community feed post per permanent account and Budapest calendar day.';
