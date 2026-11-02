-- DashReliant cluster tiers: schema, security, and seed data.

-- ---------- Tiers (A–E) ----------
create table public.tiers (
  code        text primary key check (code ~ '^[A-Z]$'),
  color_name  text not null,
  hex         text not null,
  description text not null,
  sort_order  int  not null
);

insert into public.tiers (code, color_name, hex, description, sort_order) values
  ('A', 'Green',  '#22C32A', 'Fully REMAN/TESTED and mileage programming',              1),
  ('B', 'Yellow', '#E8E022', 'Fully REMAN/TESTED, no mileage programming',              2),
  ('C', 'Orange', '#FF8A33', 'Illuminated with mileage programming',                    3),
  ('D', 'Red',    '#CC3333', 'Unpowered or illuminated cluster, no mileage correction', 4),
  ('E', 'Purple', '#8E44AD', 'Unknown — not yet tiered',                                5);

-- ---------- Clusters ----------
create table public.clusters (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,                    -- what's written on the bin
  make          text,
  models        text,
  year_start    int,
  year_end      int,
  part_numbers  text[] not null default '{}',     -- every part number seen for this cluster
  tier          text not null default 'E' references public.tiers(code) on update cascade,
  notes         text,
  source        text not null default 'manual',   -- 'manual' | 'scan'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index clusters_part_numbers_idx on public.clusters using gin (part_numbers);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger clusters_touch before update on public.clusters
  for each row execute function public.touch_updated_at();

-- ---------- Scan log (every photo lookup) ----------
create table public.scans (
  id              uuid primary key default gen_random_uuid(),
  cluster_id      uuid references public.clusters(id) on delete set null,
  matched         boolean not null,
  identified      jsonb,                          -- what Haiku said the part is
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

-- ---------- Row-level security ----------
-- Signed-in users can read everything, change tiers/notes/part numbers,
-- and add clusters by hand. Scans are inserted by the edge function.
alter table public.tiers    enable row level security;
alter table public.clusters enable row level security;
alter table public.scans    enable row level security;

create policy "read tiers"       on public.tiers    for select to authenticated using (true);
create policy "read clusters"    on public.clusters for select to authenticated using (true);
create policy "update clusters"  on public.clusters for update to authenticated using (true) with check (true);
create policy "insert clusters"  on public.clusters for insert to authenticated with check (true);
create policy "read scans"       on public.scans    for select to authenticated using (true);

-- ---------- Seed: the 11 bins ----------
insert into public.clusters (label, make, models, year_start, year_end, tier) values
  ('98 Ford Mustang',                    'Ford',                      'Mustang',                             1998, 1998, 'A'),
  ('96-97 Ford Mustang',                 'Ford',                      'Mustang',                             1996, 1997, 'A'),
  ('96-97 Ford Ranger 4WD',              'Ford',                      'Ranger 4WD',                          1996, 1997, 'A'),
  ('96-97 Ford Ranger Base',             'Ford',                      'Ranger Base',                         1996, 1997, 'A'),
  ('99-02 Escalade / Silverado / Sierra','Cadillac / Chevrolet / GMC','Escalade, Silverado, Sierra',         1999, 2002, 'A'),
  ('03-06 Escalade / Silverado / Sierra','Cadillac / Chevrolet / GMC','Escalade, Silverado, Sierra',         2003, 2006, 'A'),
  ('08-10 Charger / 08-14 Challenger',   'Dodge',                     'Charger (08-10), Challenger (08-14)', 2008, 2014, 'A'),
  ('98-99 Nissan Frontier',              'Nissan',                    'Frontier',                            1998, 1999, 'B'),
  ('03-05 Honda Civic',                  'Honda',                     'Civic',                               2003, 2005, 'B'),
  ('04-05 Ford Explorer Sport Trac',     'Ford',                      'Explorer Sport Trac',                 2004, 2005, 'B'),
  ('2004 Chevy TrailBlazer',             'Chevrolet',                 'TrailBlazer',                         2004, 2004, 'C');
