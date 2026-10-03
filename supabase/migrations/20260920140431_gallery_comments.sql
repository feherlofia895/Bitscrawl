create table public.gallery_comments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  weekly_entry_id bigint references public.weekly_entries(id) on delete cascade,
  monthly_entry_id bigint references public.monthly_entries(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint gallery_comments_one_entry check (num_nonnulls(weekly_entry_id, monthly_entry_id) = 1),
  constraint gallery_comments_content check (
    content = btrim(content) and char_length(content) between 1 and 280
  )
);

create index gallery_comments_weekly_idx
  on public.gallery_comments (weekly_entry_id, created_at, id)
  where weekly_entry_id is not null;
create index gallery_comments_monthly_idx
  on public.gallery_comments (monthly_entry_id, created_at, id)
  where monthly_entry_id is not null;
create index gallery_comments_user_idx
  on public.gallery_comments (user_id, created_at desc);

alter table public.gallery_comments enable row level security;
revoke all on public.gallery_comments from public, anon, authenticated;

create function private.get_gallery_comments(target_kind text, target_challenge_id bigint)
returns table (
  comment_id bigint, entry_id bigint, author_name text, author_avatar jsonb,
  content text, created_at timestamptz, is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_kind = 'weekly' then
    return query
    select c.id, e.id, p.display_name, p.avatar_pixels, c.content, c.created_at,
      c.user_id = auth.uid()
    from public.gallery_comments c
    join public.weekly_entries e on e.id = c.weekly_entry_id
    join public.profiles p on p.user_id = c.user_id
    where e.challenge_id = target_challenge_id and e.excluded_at is null
    order by c.created_at, c.id;
  elsif target_kind = 'monthly' then
    return query
    select c.id, e.id, p.display_name, p.avatar_pixels, c.content, c.created_at,
      c.user_id = auth.uid()
    from public.gallery_comments c
    join public.monthly_entries e on e.id = c.monthly_entry_id
    join public.monthly_challenges challenge on challenge.id = e.challenge_id
    join public.profiles p on p.user_id = c.user_id
    where e.challenge_id = target_challenge_id
      and e.submitted_at is not null
      and e.excluded_at is null
      and clock_timestamp() >= challenge.voting_starts_at
    order by c.created_at, c.id;
  else
    raise exception using errcode = 'P0001', message = 'GALLERY_KIND_INVALID';
  end if;
end;
$$;

create function private.add_gallery_comment(target_kind text, target_entry_id bigint, requested_content text)
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
  if not exists (select 1 from public.profiles p where p.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if target_kind = 'weekly' then
    if not exists (
      select 1 from public.weekly_entries e
      where e.id = target_entry_id and e.excluded_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'WEEKLY_ENTRY_NOT_FOUND';
    end if;
    insert into public.gallery_comments (user_id, weekly_entry_id, content)
    values (current_user_id, target_entry_id, clean_content)
    returning id into saved_comment_id;
  elsif target_kind = 'monthly' then
    if not exists (
      select 1
      from public.monthly_entries e
      join public.monthly_challenges c on c.id = e.challenge_id
      where e.id = target_entry_id
        and e.submitted_at is not null
        and e.excluded_at is null
        and clock_timestamp() >= c.voting_starts_at
    ) then
      raise exception using errcode = 'P0001', message = 'MONTHLY_ENTRY_NOT_FOUND';
    end if;
    insert into public.gallery_comments (user_id, monthly_entry_id, content)
    values (current_user_id, target_entry_id, clean_content)
    returning id into saved_comment_id;
  else
    raise exception using errcode = 'P0001', message = 'GALLERY_KIND_INVALID';
  end if;

  return saved_comment_id;
end;
$$;

create function public.get_gallery_comments(target_kind text, target_challenge_id bigint)
returns table (
  comment_id bigint, entry_id bigint, author_name text, author_avatar jsonb,
  content text, created_at timestamptz, is_own boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.get_gallery_comments(target_kind, target_challenge_id) $$;

create function public.add_gallery_comment(target_kind text, target_entry_id bigint, requested_content text)
returns bigint language sql security invoker set search_path = ''
as $$ select private.add_gallery_comment(target_kind, target_entry_id, requested_content) $$;

revoke all on function private.get_gallery_comments(text, bigint) from public;
revoke all on function private.add_gallery_comment(text, bigint, text) from public, anon;
grant execute on function private.get_gallery_comments(text, bigint) to anon, authenticated;
grant execute on function private.add_gallery_comment(text, bigint, text) to authenticated;

revoke all on function public.get_gallery_comments(text, bigint) from public;
revoke all on function public.add_gallery_comment(text, bigint, text) from public, anon;
grant execute on function public.get_gallery_comments(text, bigint) to anon, authenticated;
grant execute on function public.add_gallery_comment(text, bigint, text) to authenticated;
