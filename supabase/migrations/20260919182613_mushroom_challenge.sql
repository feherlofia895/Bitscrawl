update public.weekly_challenges
set
  prompt = 'Gomba',
  description = 'Készíts egy 32×32 pixeles gomba témájú rajzot a Bitscrawl tizenkét színű palettájával.',
  ends_at = ('2026-09-27 23:59:59 Europe/Budapest')::timestamptz
where starts_at <= clock_timestamp()
  and ends_at > clock_timestamp();
