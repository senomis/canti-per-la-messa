-- Canti per la messa: schema del database Supabase.
-- Da eseguire una sola volta in Supabase → SQL Editor → New query → Run.

-- ---------------------------------------------------------------- Tabelle

create table public.songs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  tags        text[] not null default '{}',
  file_path   text not null unique,      -- percorso del PDF nel bucket "songs"
  file_name   text,                      -- nome originale del file caricato
  page_count  int,
  lyrics      text,                      -- testo estratto dal PDF (per la ricerca)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  mass_date   date,                          -- data della messa (facoltativa)
  song_ids    uuid[] not null default '{}',  -- canti in ordine (ripetizioni ammesse)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index playlists_name_key on public.playlists (lower(name));

-- ---------------------------------------------------------------- Trigger

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger songs_touch before update on public.songs
  for each row execute function public.touch_updated_at();
create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_updated_at();

-- Quando un canto viene eliminato, lo si toglie da tutte le scalette salvate.
create function public.remove_song_from_playlists() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.playlists
     set song_ids = array_remove(song_ids, old.id)
   where old.id = any (song_ids);
  return old;
end $$;

create trigger songs_remove_from_playlists after delete on public.songs
  for each row execute function public.remove_song_from_playlists();

-- ---------------------------------------------------------------- Sicurezza (RLS)
-- Solo gli utenti che hanno effettuato l'accesso possono leggere e modificare.
-- IMPORTANTE: disattiva la registrazione libera (vedi README), così gli unici
-- utenti sono quelli che crei tu dalla dashboard.

alter table public.songs enable row level security;
alter table public.playlists enable row level security;

create policy "songs_authenticated" on public.songs
  for all to authenticated using (true) with check (true);
create policy "playlists_authenticated" on public.playlists
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------- Storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('songs', 'songs', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy "songs_bucket_select" on storage.objects
  for select to authenticated using (bucket_id = 'songs');
create policy "songs_bucket_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'songs');
create policy "songs_bucket_update" on storage.objects
  for update to authenticated using (bucket_id = 'songs') with check (bucket_id = 'songs');
create policy "songs_bucket_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'songs');


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
