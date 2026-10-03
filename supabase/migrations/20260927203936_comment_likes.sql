create table private.feed_comment_likes (
  comment_id bigint not null references public.feed_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (comment_id, user_id)
);

create table private.gallery_comment_likes (
  comment_id bigint not null references public.gallery_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (comment_id, user_id)
);

alter table private.feed_comment_likes enable row level security;
alter table private.gallery_comment_likes enable row level security;

revoke all on private.feed_comment_likes, private.gallery_comment_likes
  from public, anon, authenticated;

create function private.get_comment_like_states(
  target_kind text,
  target_comment_ids bigint[]
)
returns table (
  comment_id bigint,
  like_count integer,
  has_liked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if coalesce(cardinality(target_comment_ids), 0) > 100 then
    raise exception using errcode = 'P0001', message = 'COMMENT_PAGE_INVALID';
  end if;

  if target_kind = 'feed' then
    current_user_id := private.weekly_user_id();
    return query
    select
      comment_row.id,
      count(comment_like.user_id)::integer,
      coalesce(bool_or(comment_like.user_id = current_user_id), false)
    from public.feed_comments comment_row
    left join private.feed_comment_likes comment_like
      on comment_like.comment_id = comment_row.id
    where comment_row.id = any(coalesce(target_comment_ids, array[]::bigint[]))
    group by comment_row.id;
  elsif target_kind = 'gallery' then
    return query
    select
      comment_row.id,
      count(comment_like.user_id)::integer,
      coalesce(bool_or(comment_like.user_id = current_user_id), false)
    from public.gallery_comments comment_row
    left join private.gallery_comment_likes comment_like
      on comment_like.comment_id = comment_row.id
    where comment_row.id = any(coalesce(target_comment_ids, array[]::bigint[]))
    group by comment_row.id;
  else
    raise exception using errcode = 'P0001', message = 'COMMENT_KIND_INVALID';
  end if;
end;
$$;

create function private.set_comment_like(
  target_kind text,
  target_comment_id bigint,
  like_enabled boolean
)
returns table (
  liked boolean,
  active_like_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if not exists (
    select 1 from public.profiles profile where profile.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if target_kind = 'feed' then
    if not exists (
      select 1 from public.feed_comments comment_row where comment_row.id = target_comment_id
    ) then
      raise exception using errcode = 'P0001', message = 'COMMENT_NOT_FOUND';
    end if;

    if like_enabled then
      insert into private.feed_comment_likes (comment_id, user_id)
      values (target_comment_id, current_user_id)
      on conflict do nothing;
    else
      delete from private.feed_comment_likes comment_like
      where comment_like.comment_id = target_comment_id
        and comment_like.user_id = current_user_id;
    end if;

    return query
    select
      exists (
        select 1
        from private.feed_comment_likes comment_like
        where comment_like.comment_id = target_comment_id
          and comment_like.user_id = current_user_id
      ),
      (
        select count(*)::integer
        from private.feed_comment_likes comment_like
        where comment_like.comment_id = target_comment_id
      );
  elsif target_kind = 'gallery' then
    if not exists (
      select 1 from public.gallery_comments comment_row where comment_row.id = target_comment_id
    ) then
      raise exception using errcode = 'P0001', message = 'COMMENT_NOT_FOUND';
    end if;

    if like_enabled then
      insert into private.gallery_comment_likes (comment_id, user_id)
      values (target_comment_id, current_user_id)
      on conflict do nothing;
    else
      delete from private.gallery_comment_likes comment_like
      where comment_like.comment_id = target_comment_id
        and comment_like.user_id = current_user_id;
    end if;

    return query
    select
      exists (
        select 1
        from private.gallery_comment_likes comment_like
        where comment_like.comment_id = target_comment_id
          and comment_like.user_id = current_user_id
      ),
      (
        select count(*)::integer
        from private.gallery_comment_likes comment_like
        where comment_like.comment_id = target_comment_id
      );
  else
    raise exception using errcode = 'P0001', message = 'COMMENT_KIND_INVALID';
  end if;
end;
$$;

create function public.get_comment_like_states(
  target_kind text,
  target_comment_ids bigint[]
)
returns table (
  comment_id bigint,
  like_count integer,
  has_liked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_comment_like_states(target_kind, target_comment_ids)
$$;

create function public.set_comment_like(
  target_kind text,
  target_comment_id bigint,
  like_enabled boolean
)
returns table (
  liked boolean,
  active_like_count integer
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_comment_like(target_kind, target_comment_id, like_enabled)
$$;

revoke all on function private.get_comment_like_states(text, bigint[]) from public;
revoke all on function private.set_comment_like(text, bigint, boolean) from public, anon;
revoke all on function public.get_comment_like_states(text, bigint[]) from public;
revoke all on function public.set_comment_like(text, bigint, boolean) from public, anon;

grant execute on function private.get_comment_like_states(text, bigint[]) to anon, authenticated;
grant execute on function private.set_comment_like(text, bigint, boolean) to authenticated;
grant execute on function public.get_comment_like_states(text, bigint[]) to anon, authenticated;
grant execute on function public.set_comment_like(text, bigint, boolean) to authenticated;

comment on table private.feed_comment_likes is
  'One reversible reaction per permanent profile and Rajzfal comment; excluded from profile like totals.';
comment on table private.gallery_comment_likes is
  'One reversible reaction per permanent profile and challenge-gallery comment; excluded from profile like totals.';
