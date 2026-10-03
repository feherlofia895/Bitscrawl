do $$
begin
  if not exists (
    select 1
    from public.weekly_challenges
    where week_key = '2026-W40'
      and prompt = 'Boszorkány'
  ) then
    raise exception 'WEEKLY_WITCH_CHALLENGE_NOT_FOUND';
  end if;

  update public.weekly_challenges
  set starts_at = ('2026-09-27 23:00:00 Europe/Budapest')::timestamptz
  where week_key = '2026-W40'
    and prompt = 'Boszorkány';
end;
$$;
