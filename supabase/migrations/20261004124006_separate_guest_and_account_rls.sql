-- Anonymous Auth users intentionally keep multiplayer access, but account-only
-- rows must require an explicit permanent-user JWT in addition to ownership.
alter policy profiles_owner_read
on public.profiles
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = user_id
);

alter policy weekly_drafts_owner_read
on public.weekly_drafts
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = user_id
);

alter policy weekly_entries_owner_read
on public.weekly_entries
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = user_id
);

alter policy weekly_votes_owner_read
on public.weekly_votes
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = voter_user_id
);

alter policy monthly_entries_owner_read
on public.monthly_entries
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = user_id
);

alter policy monthly_votes_owner_read
on public.monthly_votes
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and (select auth.uid()) = voter_user_id
);

alter policy lobby_messages_profile_read
on public.lobby_messages
using (
  not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
  and exists (
    select 1
    from public.profiles profile
    where profile.user_id = (select auth.uid())
  )
);

-- Supabase owns the Realtime schema. RLS policies remain editable in hosted
-- projects, while the guard keeps isolated PGlite migration replays portable.
do $migration$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      alter policy global_lobby_presence_read
      on realtime.messages
      using (
        not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
        and (select realtime.topic()) = 'global-lobby'
        and extension = 'presence'
        and exists (
          select 1
          from public.profiles profile
          where profile.user_id = (select auth.uid())
        )
      )
    $policy$;

    execute $policy$
      alter policy global_lobby_presence_write
      on realtime.messages
      with check (
        not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true)
        and (select realtime.topic()) = 'global-lobby'
        and extension = 'presence'
        and exists (
          select 1
          from public.profiles profile
          where profile.user_id = (select auth.uid())
        )
      )
    $policy$;
  end if;
end;
$migration$;
