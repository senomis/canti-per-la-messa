-- Ruolo admin e tipologie dei canti modificabili dall'app (solo dall'admin).
-- Da eseguire una volta in Supabase → SQL Editor, sui database creati prima di questa modifica.

-- ---------------------------------------------------------------- Ruolo admin
-- Il ruolo sta in "app_metadata" dell'utente: lo può cambiare solo il server
-- (SQL Editor o chiave segreta), non l'utente stesso dall'app.

create or replace function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- ---------------------------------------------------------------- Tipologie

create table if not exists public.tags (
  id          text primary key check (id ~ '^[a-z0-9_]+$'),  -- codice salvato nei canti
  label       text not null check (length(trim(label)) > 0), -- nome mostrato, modificabile
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create unique index if not exists tags_label_key on public.tags (lower(label));

insert into public.tags (id, label, position) values
  ('ingresso', 'Ingresso', 1),
  ('vangelo', 'Al Vangelo', 2),
  ('offertorio', 'Offertorio', 3),
  ('comunione', 'Comunione', 4),
  ('conclusione', 'Conclusione', 5),
  ('spirito_santo', 'Spirito Santo', 6),
  ('natalizio', 'Natalizio', 7),
  ('pasquale', 'Pasquale', 8),
  ('quaresimale', 'Quaresimale', 9),
  ('avvento', 'Avvento', 10),
  ('mariano', 'Mariano', 11),
  ('missionario', 'Missionario', 12),
  ('altro', 'Altro', 13)
on conflict (id) do nothing;

alter table public.tags enable row level security;

drop policy if exists "tags_select" on public.tags;
drop policy if exists "tags_admin_insert" on public.tags;
drop policy if exists "tags_admin_update" on public.tags;
drop policy if exists "tags_admin_delete" on public.tags;

create policy "tags_select" on public.tags
  for select to authenticated using (true);
create policy "tags_admin_insert" on public.tags
  for insert to authenticated with check (public.is_admin());
create policy "tags_admin_update" on public.tags
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "tags_admin_delete" on public.tags
  for delete to authenticated using (public.is_admin());

-- Quando una tipologia viene eliminata, la si toglie da tutti i canti.
create or replace function public.remove_tag_from_songs() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.songs
     set tags = array_remove(tags, old.id)
   where old.id = any (tags);
  return old;
end $$;

drop trigger if exists tags_remove_from_songs on public.tags;
create trigger tags_remove_from_songs after delete on public.tags
  for each row execute function public.remove_tag_from_songs();
