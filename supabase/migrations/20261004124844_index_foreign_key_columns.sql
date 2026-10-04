-- Index the referencing side of user/profile foreign keys. These columns are not
-- leftmost in their existing composite indexes, so parent deletes and user-based
-- lookups would otherwise scan the child tables as they grow.
create index competition_entries_user_id_idx
  on private.competition_entries (user_id);

create index competition_votes_drawing_user_id_idx
  on private.competition_votes (drawing_user_id);

create index competition_votes_voter_user_id_idx
  on private.competition_votes (voter_user_id);

create index feed_comment_likes_user_id_idx
  on private.feed_comment_likes (user_id);

create index gallery_comment_likes_user_id_idx
  on private.gallery_comment_likes (user_id);

create index profile_avatar_likes_liker_user_id_idx
  on private.profile_avatar_likes (liker_user_id);

create index competition_draw_events_user_id_idx
  on public.competition_draw_events (user_id);

-- No reverse-order duplicates are added for weekly_votes or monthly_votes.
-- Their existing (challenge_id, entry_id) indexes fully serve the two equality
-- predicates used by the (entry_id, challenge_id) foreign-key checks.
