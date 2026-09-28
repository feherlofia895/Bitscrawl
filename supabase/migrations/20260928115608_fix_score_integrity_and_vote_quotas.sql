create or replace function private.finalize_weekly_challenge(target_challenge_id bigint)
returns table (
  challenge_id bigint,
  awards_count integer,
  total_vote_points bigint,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_finalized_at timestamptz;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  select challenge.finalized_at
  into current_finalized_at
  from public.weekly_challenges challenge
  where challenge.id = target_challenge_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_NOT_FOUND';
  end if;

  if current_finalized_at is not null then
    return query
    select
      target_challenge_id,
      count(*)::integer,
      coalesce(sum(award.vote_points), 0)::bigint,
      true
    from private.weekly_score_awards award
    where award.challenge_id = target_challenge_id;
    return;
  end if;

  update public.weekly_challenges challenge
  set
    ends_at = least(challenge.ends_at, clock_timestamp()),
    finalized_at = clock_timestamp()
  where challenge.id = target_challenge_id;

  with vote_totals as (
    select
      entry.user_id,
      case
        when challenge.week_key = '2026-W38'
          and challenge.prompt = 'Gomba'
          and lower(profile.display_name) = 'martinteteme'
          then 0
        else count(vote.entry_id)::integer
      end as vote_points
    from public.weekly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    join public.weekly_challenges challenge on challenge.id = entry.challenge_id
    left join public.weekly_votes vote
      on vote.challenge_id = entry.challenge_id
      and vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.excluded_at is null
    group by
      entry.user_id,
      challenge.week_key,
      challenge.prompt,
      profile.display_name
  )
  insert into private.weekly_score_awards (
    challenge_id,
    user_id,
    vote_points,
    bonus_points,
    placement
  )
  select
    target_challenge_id,
    totals.user_id,
    totals.vote_points,
    0,
    null
  from vote_totals totals;

  perform private.recalculate_weekly_score_placements(target_challenge_id);

  return query
  select
    target_challenge_id,
    count(*)::integer,
    coalesce(sum(award.vote_points), 0)::bigint,
    false
  from private.weekly_score_awards award
  where award.challenge_id = target_challenge_id;
end;
$$;

do $$
declare
  corrected_challenge_id bigint;
  updated_rows integer;
begin
  update private.weekly_score_awards award
  set
    entry_points = 1,
    vote_points = 0,
    bonus_points = 0,
    placement = null,
    excluded_at = null,
    exclusion_reason = null
  from public.profiles profile, public.weekly_challenges challenge
  where profile.user_id = award.user_id
    and challenge.id = award.challenge_id
    and lower(profile.display_name) = 'martinteteme'
    and challenge.week_key = '2026-W38'
    and challenge.prompt = 'Gomba'
  returning award.challenge_id into corrected_challenge_id;

  get diagnostics updated_rows = row_count;

  if updated_rows > 1 then
    raise exception 'Expected at most one martinteteme award, corrected %', updated_rows;
  end if;

  if corrected_challenge_id is not null then
    perform private.recalculate_weekly_score_placements(corrected_challenge_id);
  end if;
end;
$$;

create or replace function private.get_weekly_gallery(target_challenge_id bigint)
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
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.weekly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.weekly_votes vote on vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.submitted_at,
    entry.votes,
    exists (
      select 1
      from public.weekly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    exists (
      select 1
      from private.weekly_score_awards award
      join public.weekly_challenges challenge on challenge.id = award.challenge_id
      where award.challenge_id = target_challenge_id
        and award.user_id = entry.user_id
        and award.excluded_at is null
        and award.placement = 1
        and challenge.finalized_at is not null
    )
  from entries_with_votes entry;
$$;

create or replace function private.get_weekly_gallery_page(
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
  submitted_at timestamptz,
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
  with entries_with_votes as (
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.weekly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.weekly_votes vote on vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.submitted_at,
      profile.display_name,
      profile.avatar_pixels
  ), prepared as (
    select
      entry.*,
      count(*) over () as all_entries
    from entries_with_votes entry
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.submitted_at,
    entry.votes,
    (
      select count(*)::integer
      from public.gallery_comments comment_row
      where comment_row.weekly_entry_id = entry.id
    ),
    exists (
      select 1
      from public.weekly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    exists (
      select 1
      from private.weekly_score_awards award
      join public.weekly_challenges challenge on challenge.id = award.challenge_id
      where award.challenge_id = target_challenge_id
        and award.user_id = entry.user_id
        and award.excluded_at is null
        and award.placement = 1
        and challenge.finalized_at is not null
    ),
    entry.all_entries
  from prepared entry
  order by
    case when safe_sort = 'likes' then entry.votes end desc,
    case when safe_sort = 'likes' then entry.submitted_at end desc,
    case when safe_sort = 'newest' then entry.submitted_at end desc,
    case when safe_sort = 'discovery' then md5(entry.id::text || ':' || safe_seed::text) end,
    entry.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function private.moderate_delete_content(target_kind text, target_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id bigint;
  affected_challenge_id bigint;
  affected_user_id uuid;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  case target_kind
    when 'feed-post' then
      delete from public.feed_posts post
      where post.id = target_id
      returning post.id into affected_id;
    when 'weekly-entry' then
      select entry.challenge_id, entry.user_id
      into affected_challenge_id, affected_user_id
      from public.weekly_entries entry
      where entry.id = target_id;

      if not found then
        raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
      end if;

      perform 1
      from public.weekly_challenges challenge
      where challenge.id = affected_challenge_id
      for update;

      update public.weekly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;

      update private.weekly_score_awards award
      set
        excluded_at = coalesce(award.excluded_at, clock_timestamp()),
        exclusion_reason = coalesce(
          award.exclusion_reason,
          'Moderált heti nevezés miatt érvénytelenített eredmény.'
        ),
        placement = null
      where award.challenge_id = affected_challenge_id
        and award.user_id = affected_user_id;

      perform private.recalculate_weekly_score_placements(affected_challenge_id);
    when 'monthly-entry' then
      update public.monthly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;
    when 'feed-comment' then
      delete from public.feed_comments comment_row
      where comment_row.id = target_id
      returning comment_row.id into affected_id;
    when 'gallery-comment' then
      delete from public.gallery_comments comment_row
      where comment_row.id = target_id
      returning comment_row.id into affected_id;
    else
      raise exception using errcode = 'P0001', message = 'MODERATION_KIND_INVALID';
  end case;

  if affected_id is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
  end if;

  return true;
end;
$$;

create or replace function private.set_weekly_vote(target_entry_id bigint, vote_enabled boolean)
returns table (voted boolean, active_vote_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  target_challenge_id bigint;
  entry_owner_id uuid;
  vote_count integer;
  vote_is_active boolean;
begin
  select entry.challenge_id, entry.user_id
  into target_challenge_id, entry_owner_id
  from public.weekly_entries entry
  where entry.id = target_entry_id
    and entry.excluded_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_ENTRY_NOT_FOUND';
  end if;
  if not private.weekly_challenge_is_active(target_challenge_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_CLOSED';
  end if;
  if entry_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'WEEKLY_OWN_VOTE_FORBIDDEN';
  end if;

  perform 1
  from public.profiles profile
  where profile.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if vote_enabled then
    if not exists (
      select 1
      from public.weekly_votes vote
      where vote.entry_id = target_entry_id
        and vote.voter_user_id = current_user_id
    ) and (
      select count(*)
      from public.weekly_votes vote
      join public.weekly_entries entry
        on entry.id = vote.entry_id
        and entry.challenge_id = vote.challenge_id
      where vote.challenge_id = target_challenge_id
        and vote.voter_user_id = current_user_id
        and entry.excluded_at is null
    ) >= 3 then
      raise exception using errcode = 'P0001', message = 'WEEKLY_VOTE_LIMIT';
    end if;

    insert into public.weekly_votes (challenge_id, entry_id, voter_user_id)
    values (target_challenge_id, target_entry_id, current_user_id)
    on conflict (entry_id, voter_user_id) do nothing;
  else
    delete from public.weekly_votes
    where entry_id = target_entry_id
      and voter_user_id = current_user_id;
  end if;

  select exists (
    select 1
    from public.weekly_votes vote
    where vote.entry_id = target_entry_id
      and vote.voter_user_id = current_user_id
  ) into vote_is_active;

  select count(*)::integer
  into vote_count
  from public.weekly_votes vote
  join public.weekly_entries entry
    on entry.id = vote.entry_id
    and entry.challenge_id = vote.challenge_id
  where vote.challenge_id = target_challenge_id
    and vote.voter_user_id = current_user_id
    and entry.excluded_at is null;

  return query select vote_is_active, vote_count;
end;
$$;

create function private.get_weekly_account_state(target_challenge_id bigint)
returns table (
  profile_name text,
  draft_pixels jsonb,
  entry_id bigint,
  entry_pixels jsonb,
  votes_used integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.display_name,
    draft.pixels,
    own_entry.id,
    own_entry.pixels,
    (
      select count(*)::integer
      from public.weekly_votes vote
      join public.weekly_entries voted_entry
        on voted_entry.id = vote.entry_id
        and voted_entry.challenge_id = vote.challenge_id
      where vote.challenge_id = target_challenge_id
        and vote.voter_user_id = private.weekly_user_id()
        and voted_entry.excluded_at is null
    )
  from (select private.weekly_user_id() as user_id) session_user_row
  left join public.profiles profile on profile.user_id = session_user_row.user_id
  left join public.weekly_drafts draft
    on draft.challenge_id = target_challenge_id
    and draft.user_id = session_user_row.user_id
  left join public.weekly_entries own_entry
    on own_entry.challenge_id = target_challenge_id
    and own_entry.user_id = session_user_row.user_id;
$$;

create or replace function public.get_weekly_account_state(target_challenge_id bigint)
returns table (
  profile_name text,
  draft_pixels jsonb,
  entry_id bigint,
  entry_pixels jsonb,
  votes_used integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_weekly_account_state(target_challenge_id)
$$;

create or replace function private.set_monthly_vote(target_entry_id bigint, vote_enabled boolean)
returns table (voted boolean, active_vote_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  target_challenge_id bigint;
  entry_owner_id uuid;
  vote_count integer;
  vote_is_active boolean;
begin
  select entry.challenge_id, entry.user_id
  into target_challenge_id, entry_owner_id
  from public.monthly_entries entry
  where entry.id = target_entry_id
    and entry.submitted_at is not null
    and entry.excluded_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'MONTHLY_ENTRY_NOT_FOUND';
  end if;
  if private.monthly_challenge_status(target_challenge_id) <> 'voting' then
    raise exception using errcode = 'P0001', message = 'MONTHLY_VOTING_CLOSED';
  end if;
  if entry_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'MONTHLY_OWN_VOTE_FORBIDDEN';
  end if;

  perform 1
  from public.profiles profile
  where profile.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if vote_enabled then
    if not exists (
      select 1
      from public.monthly_votes vote
      where vote.entry_id = target_entry_id
        and vote.voter_user_id = current_user_id
    ) and (
      select count(*)
      from public.monthly_votes vote
      join public.monthly_entries entry
        on entry.id = vote.entry_id
        and entry.challenge_id = vote.challenge_id
      where vote.challenge_id = target_challenge_id
        and vote.voter_user_id = current_user_id
        and entry.submitted_at is not null
        and entry.excluded_at is null
    ) >= 3 then
      raise exception using errcode = 'P0001', message = 'MONTHLY_VOTE_LIMIT';
    end if;

    insert into public.monthly_votes (challenge_id, entry_id, voter_user_id)
    values (target_challenge_id, target_entry_id, current_user_id)
    on conflict (entry_id, voter_user_id) do nothing;
  else
    delete from public.monthly_votes
    where entry_id = target_entry_id
      and voter_user_id = current_user_id;
  end if;

  select exists (
    select 1
    from public.monthly_votes vote
    where vote.entry_id = target_entry_id
      and vote.voter_user_id = current_user_id
  ) into vote_is_active;

  select count(*)::integer
  into vote_count
  from public.monthly_votes vote
  join public.monthly_entries entry
    on entry.id = vote.entry_id
    and entry.challenge_id = vote.challenge_id
  where vote.challenge_id = target_challenge_id
    and vote.voter_user_id = current_user_id
    and entry.submitted_at is not null
    and entry.excluded_at is null;

  return query select vote_is_active, vote_count;
end;
$$;

create function private.get_monthly_account_state(target_challenge_id bigint)
returns table (
  profile_name text,
  entry_id bigint,
  entry_pixels jsonb,
  updated_at timestamptz,
  submitted_at timestamptz,
  votes_used integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.display_name,
    own_entry.id,
    own_entry.pixels,
    own_entry.updated_at,
    own_entry.submitted_at,
    (
      select count(*)::integer
      from public.monthly_votes vote
      join public.monthly_entries voted_entry
        on voted_entry.id = vote.entry_id
        and voted_entry.challenge_id = vote.challenge_id
      where vote.challenge_id = target_challenge_id
        and vote.voter_user_id = private.weekly_user_id()
        and voted_entry.submitted_at is not null
        and voted_entry.excluded_at is null
    )
  from (select private.weekly_user_id() as user_id) session_user_row
  left join public.profiles profile on profile.user_id = session_user_row.user_id
  left join public.monthly_entries own_entry
    on own_entry.challenge_id = target_challenge_id
    and own_entry.user_id = session_user_row.user_id;
$$;

create or replace function public.get_monthly_account_state(target_challenge_id bigint)
returns table (
  profile_name text,
  entry_id bigint,
  entry_pixels jsonb,
  updated_at timestamptz,
  submitted_at timestamptz,
  votes_used integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_monthly_account_state(target_challenge_id)
$$;

revoke all on function private.finalize_weekly_challenge(bigint) from public, anon;
grant execute on function private.finalize_weekly_challenge(bigint) to authenticated;

revoke all on function private.get_weekly_gallery(bigint) from public;
grant execute on function private.get_weekly_gallery(bigint) to anon, authenticated;
revoke all on function private.get_weekly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function private.get_weekly_gallery_page(bigint, text, bigint, integer, integer) to anon, authenticated;

revoke all on function private.moderate_delete_content(text, bigint) from public, anon;
grant execute on function private.moderate_delete_content(text, bigint) to authenticated;

revoke all on function private.set_weekly_vote(bigint, boolean) from public, anon;
grant execute on function private.set_weekly_vote(bigint, boolean) to authenticated;
revoke all on function private.get_weekly_account_state(bigint) from public, anon;
grant execute on function private.get_weekly_account_state(bigint) to authenticated;
revoke all on function public.get_weekly_account_state(bigint) from public, anon;
grant execute on function public.get_weekly_account_state(bigint) to authenticated;

revoke all on function private.set_monthly_vote(bigint, boolean) from public, anon;
grant execute on function private.set_monthly_vote(bigint, boolean) to authenticated;
revoke all on function private.get_monthly_account_state(bigint) from public, anon;
grant execute on function private.get_monthly_account_state(bigint) to authenticated;
revoke all on function public.get_monthly_account_state(bigint) from public, anon;
grant execute on function public.get_monthly_account_state(bigint) to authenticated;

comment on function private.finalize_weekly_challenge(bigint) is
  'Finalizes one weekly challenge; only martinteteme in 2026-W38 Gomba keeps participation-only scoring.';
comment on function public.moderate_delete_content(text, bigint) is
  'Atomically moderates content and removes finalized weekly results before recalculating the podium.';
