drop function public.get_weekly_gallery(bigint);
drop function private.get_weekly_gallery(bigint);

create function private.get_weekly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  submitted_at timestamptz,
  vote_count bigint,
  has_voted boolean,
  is_own boolean,
  is_winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with entries_with_votes as (
    select e.id, e.user_id, e.pixels, e.submitted_at, p.display_name, p.avatar_pixels,
      count(v.entry_id)::bigint as votes
    from public.weekly_entries as e
    join public.profiles as p on p.user_id = e.user_id
    left join public.weekly_votes as v on v.entry_id = e.id
    where e.challenge_id = target_challenge_id and e.excluded_at is null
    group by e.id, e.user_id, e.pixels, e.submitted_at, p.display_name, p.avatar_pixels
  ), totals as (select coalesce(max(votes), 0) as top_votes from entries_with_votes),
  challenge as (select ends_at from public.weekly_challenges where id = target_challenge_id)
  select e.id, e.display_name, e.avatar_pixels, e.pixels, e.submitted_at, e.votes,
    exists (select 1 from public.weekly_votes v where v.entry_id = e.id and v.voter_user_id = auth.uid()),
    e.user_id = auth.uid(),
    clock_timestamp() >= c.ends_at and e.votes = t.top_votes
  from entries_with_votes e cross join totals t cross join challenge c;
$$;

create function public.get_weekly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  submitted_at timestamptz, vote_count bigint, has_voted boolean,
  is_own boolean, is_winner boolean
)
language sql
security invoker
set search_path = ''
as $$ select * from private.get_weekly_gallery(target_challenge_id) $$;

revoke all on function private.get_weekly_gallery(bigint) from public;
grant execute on function private.get_weekly_gallery(bigint) to anon, authenticated;
revoke all on function public.get_weekly_gallery(bigint) from public;
grant execute on function public.get_weekly_gallery(bigint) to anon, authenticated;
