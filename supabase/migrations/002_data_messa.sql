-- Aggiunge la data della messa alle scalette (usata per la copertina e per "Duplica").
-- Da eseguire una volta in Supabase → SQL Editor, sui database creati prima di questa modifica.
alter table public.playlists add column if not exists mass_date date;
