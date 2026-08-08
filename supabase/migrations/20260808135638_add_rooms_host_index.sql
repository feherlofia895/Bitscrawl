-- Index the foreign key used for host lookups and cascading deletes.
create index rooms_host_user_id_idx
  on public.rooms (host_user_id);
