update public.feed_posts post
set description = '',
  updated_at = clock_timestamp()
from public.profiles profile
where profile.user_id = post.user_id
  and profile.display_name = 'Vivi'
  and post.description = 'Hóember – a korábbi havi kihívásra készült rajz.'
  and jsonb_array_length(post.pixels) = 1024;
