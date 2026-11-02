-- Track how often each Unknown (tier E) cluster comes through, so the most
-- common unknowns can be researched and tiered first.

alter table public.clusters
  add column unknown_seen int not null default 0,
  add column last_seen_at timestamptz;

-- Unknowns already created by scans count as seen at least once.
update public.clusters c
set unknown_seen = greatest(1, (select count(*) from public.scans s where s.cluster_id = c.id)),
    last_seen_at = coalesce((select max(created_at) from public.scans s where s.cluster_id = c.id), c.created_at)
where c.tier = 'E' and c.source = 'scan';

create index clusters_unknown_seen_idx on public.clusters (unknown_seen desc) where tier = 'E';

-- +1 sighting for an Unknown cluster. Does nothing once it has a real tier.
-- Runs with the caller's rights, so row-level security still applies.
create or replace function public.bump_unknown(p_id uuid)
returns setof public.clusters
language sql
security invoker
set search_path = ''
as $$
  update public.clusters
     set unknown_seen = unknown_seen + 1,
         last_seen_at = now()
   where id = p_id and tier = 'E'
  returning *;
$$;

revoke execute on function public.bump_unknown(uuid) from public, anon;
grant execute on function public.bump_unknown(uuid) to authenticated, service_role;
