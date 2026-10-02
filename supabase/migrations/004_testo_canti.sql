-- Testo dei canti estratto dai PDF, per la ricerca nel testo.
-- Da eseguire una volta in Supabase → SQL Editor, sui database creati prima di questa modifica.
-- Vuoto (null) = non ancora indicizzato: l'admin lo riempie con "Indicizza i testi".
alter table public.songs add column if not exists lyrics text;
