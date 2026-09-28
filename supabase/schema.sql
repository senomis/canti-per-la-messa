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
