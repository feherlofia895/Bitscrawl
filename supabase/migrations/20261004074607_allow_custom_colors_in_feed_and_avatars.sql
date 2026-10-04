create or replace function private.feed_pixels_valid(candidate jsonb)
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
          or not (
            pixel.value #>> '{}' = 'transparent'
            or pixel.value #>> '{}' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
          )
      )
  end;
$$;

create or replace function private.profile_avatar_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate is null then true
    when jsonb_typeof(candidate) <> 'array' then false
    else jsonb_array_length(candidate) = 1024
      and not exists (
        select 1
        from jsonb_array_elements(candidate) as pixel(value)
        where jsonb_typeof(pixel.value) <> 'string'
          or not (
            pixel.value #>> '{}' = 'transparent'
            or pixel.value #>> '{}' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
          )
      )
  end;
$$;

revoke all on function private.feed_pixels_valid(jsonb) from public, anon, authenticated;
revoke all on function private.profile_avatar_pixels_valid(jsonb) from public, anon, authenticated;

comment on function private.feed_pixels_valid(jsonb) is
  'Validates 32 by 32 daily feed drawings with transparent, RGB, or RGBA hex pixels.';
comment on function private.profile_avatar_pixels_valid(jsonb) is
  'Validates optional 32 by 32 profile avatars with transparent, RGB, or RGBA hex pixels.';
