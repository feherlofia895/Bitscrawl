create function private.update_gallery_comment(target_comment_id bigint, requested_content text)
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

  update public.gallery_comments c
  set content = clean_content
  where c.id = target_comment_id and c.user_id = current_user_id
  returning c.content into saved_content;

  if saved_content is null then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_NOT_OWN';
  end if;

  return saved_content;
end;
$$;

create function public.update_gallery_comment(target_comment_id bigint, requested_content text)
returns text language sql security invoker set search_path = ''
as $$ select private.update_gallery_comment(target_comment_id, requested_content) $$;

revoke all on function private.update_gallery_comment(bigint, text) from public, anon;
grant execute on function private.update_gallery_comment(bigint, text) to authenticated;

revoke all on function public.update_gallery_comment(bigint, text) from public, anon;
grant execute on function public.update_gallery_comment(bigint, text) to authenticated;
