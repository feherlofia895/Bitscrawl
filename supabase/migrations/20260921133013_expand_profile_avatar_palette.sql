create or replace function private.profile_avatar_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select candidate is null or (
    jsonb_typeof(candidate) = 'array'
    and jsonb_array_length(candidate) = 1024
    and not exists (
      select 1 from jsonb_array_elements_text(candidate) as pixel(color)
      where pixel.color is null or pixel.color not in (
        'transparent',
        '#f7f3e8', '#d8cfbd', '#999ea1', '#66707a', '#3f4650', '#242630', '#230a19', '#0f111a',
        '#7d2d3b', '#d3493b', '#f25c54', '#da7149', '#e29958', '#f2b35d', '#f5e57a', '#fff1a8',
        '#4d5b32', '#718441', '#a5d967', '#d4eb7a', '#2e6b4f', '#67ba62', '#549d8c', '#79cbb8',
        '#1e4957', '#347f8c', '#33567e', '#4b79b8', '#221a5f', '#51439a', '#8d5a9f', '#c57ca8'
      )
    )
  );
$$;
