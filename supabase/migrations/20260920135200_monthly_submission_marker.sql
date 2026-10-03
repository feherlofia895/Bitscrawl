alter table public.monthly_entries
  add column submitted_at timestamptz;

create index monthly_entries_submitted_idx
  on public.monthly_entries (challenge_id, submitted_at)
  where submitted_at is not null and excluded_at is null;

create function private.submit_monthly_entry(target_challenge_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  submission_time timestamptz;
begin
  if private.monthly_challenge_status(target_challenge_id) <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;

  update public.monthly_entries e
  set submitted_at = coalesce(e.submitted_at, clock_timestamp())
  where e.challenge_id = target_challenge_id
    and e.user_id = current_user_id
    and e.excluded_at is null
    and private.weekly_pixels_valid(e.pixels)
    and exists (
      select 1 from jsonb_array_elements_text(e.pixels) pixel(value)
      where pixel.value <> 'transparent'
    )
  returning e.submitted_at into submission_time;

  if submission_time is null then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_INVALID';
  end if;

  return submission_time;
end;
$$;

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
    select c.ends_at, c.voting_starts_at from public.monthly_challenges c
    where c.id = target_challenge_id and clock_timestamp() >= c.voting_starts_at
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

drop function public.get_monthly_account_state(bigint);
create function public.get_monthly_account_state(target_challenge_id bigint)
returns table (
  profile_name text, entry_id bigint, entry_pixels jsonb, updated_at timestamptz,
  submitted_at timestamptz, votes_used integer
)
language sql security invoker set search_path = ''
as $$
  select p.display_name, e.id, e.pixels, e.updated_at, e.submitted_at,
    (select count(*)::integer from public.monthly_votes v
      where v.challenge_id = target_challenge_id and v.voter_user_id = private.weekly_user_id())
  from (select private.weekly_user_id() as user_id) u
  left join public.profiles p on p.user_id = u.user_id
  left join public.monthly_entries e
    on e.challenge_id = target_challenge_id and e.user_id = u.user_id;
$$;

create function public.submit_monthly_entry(target_challenge_id bigint)
returns timestamptz language sql security invoker set search_path = ''
as $$ select private.submit_monthly_entry(target_challenge_id) $$;

revoke all on function private.submit_monthly_entry(bigint) from public, anon;
grant execute on function private.submit_monthly_entry(bigint) to authenticated;

revoke all on function public.get_monthly_account_state(bigint) from public, anon;
grant execute on function public.get_monthly_account_state(bigint) to authenticated;

revoke all on function public.submit_monthly_entry(bigint) from public, anon;
grant execute on function public.submit_monthly_entry(bigint) to authenticated;
