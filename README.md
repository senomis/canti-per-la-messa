# Canti per la messa

Web app per gestire un archivio di canti (un PDF per canto) e creare scalette da scaricare
come un unico PDF.

- **Ricerca** per titolo (anche parziale, senza badare ad accenti o maiuscole) e per tipologia.
- **Archivio**: aggiunta di un canto (PDF + tipologie), importazione di molti PDF insieme,
  modifica (titolo, tipologie, sostituzione del file), eliminazione.
- **Scalette**: composizione, riordino (trascinamento o frecce), salvataggio con nome e data
  della messa, duplicazione (la copia prende la data della settimana dopo), download del PDF
  unito nell'ordine della scaletta.
- **PDF della scaletta**: anteprima delle pagine prima di scaricare, copertina facoltativa
  (nome, data, elenco dei canti con la pagina di inizio), rimozione facoltativa della pagina
  nera dopo l'ultimo canto (solo se è davvero nera).

L'unione dei PDF avviene nel browser ([pdf-lib](https://pdf-lib.js.org)): i file vengono
copiati così come sono, compresa la pagina nera finale di ogni canto.

## Architettura (tutta gratuita)

| Parte | Servizio |
|---|---|
| Sito (HTML/JS statico, senza build) | GitHub Pages, Netlify o Cloudflare Pages |
| Database (canti, scalette) | Supabase – Postgres |
| File PDF | Supabase – Storage (bucket privato `songs`) |
| Login dei collaboratori | Supabase – Auth (email + password) |

Limiti del piano gratuito Supabase da tenere presenti: 1 GB di storage (circa 3.000–10.000
canti, a seconda del peso dei PDF), 500 MB di database, e **il progetto viene messo in pausa
dopo 7 giorni senza utilizzo** (si riattiva con un clic dalla dashboard; i dati non si perdono).

## Provarla subito (modalità demo)

Con `js/config.js` non compilato l'app parte in modalità demo con canti di esempio in memoria.
In locale serve un piccolo server (i moduli JavaScript non funzionano aprendo il file con doppio clic):

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

poi apri <http://localhost:8080>. Aggiungendo `?demo` all'indirizzo
(<http://localhost:8080/?demo>) si usa la modalità demo anche con Supabase configurato.

## Aggiornamenti del database

Se il database è stato creato con una versione precedente di `schema.sql`, esegui nel
SQL Editor, in ordine, i file di [`supabase/migrations`](supabase/migrations) non ancora applicati.

## Installazione

### 1. Crea il progetto Supabase

1. Registrati su <https://supabase.com> e crea un nuovo progetto (regione: *Central EU*).
2. **SQL Editor → New query**: incolla il contenuto di [`supabase/schema.sql`](supabase/schema.sql)
   e premi **Run**. Crea le tabelle, le regole di sicurezza e il bucket `songs`.

### 2. Chiudi le registrazioni e crea gli utenti

1. **Authentication → Sign In / Providers → Email**: lascia attivo il provider Email ma
   **disattiva “Allow new users to sign up”**. È indispensabile: altrimenti chiunque potrebbe
   registrarsi e accedere all'archivio.
2. **Authentication → Users → Add user → Create new user**: inserisci email e password
   di ogni collaboratore, spunta *Auto Confirm User*. Comunica la password all'interessato,
   che potrà cambiarla dall'app (“Cambia password”).

### 3. Collega l'app a Supabase

In **Project Settings → API** (o *API Keys*) copia il *Project URL* e la chiave pubblica
(*anon* / *publishable*) e inseriscili in [`js/config.js`](js/config.js):

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';   // oppure sb_publishable_...
```

La chiave pubblica può stare nel codice del sito: i dati sono protetti dalle regole RLS e
dal login. **Non usare mai la chiave `service_role` / `secret`.**

### 4. Pubblica il sito (GitHub Pages)

1. Crea un repository su GitHub e carica tutti i file di questa cartella.
2. **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, cartella `/ (root)`.
3. Dopo un minuto il sito è su `https://<utente>.github.io/<repository>/`.

In alternativa: trascina la cartella su <https://app.netlify.com/drop>.

## Ruoli

Ci sono due ruoli:

- **admin**: può fare tutto, compresa la gestione delle **tipologie** (pulsante “Tipologie”:
  aggiungere, rinominare, riordinare, eliminare).
- **collaboratore** (tutti gli altri): gestisce canti e scalette, usa le tipologie esistenti.

Il ruolo si assegna nel SQL Editor di Supabase (l'utente deve poi uscire e rientrare nell'app):

```sql
-- rendere admin
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
 where email = 'nome@esempio.it';

-- togliere il ruolo admin
update auth.users
   set raw_app_meta_data = raw_app_meta_data - 'role'
 where email = 'nome@esempio.it';
```

Il limite è applicato anche dal database (regole RLS sulla tabella `tags`), non solo
nascondendo il pulsante. Gli utenti si creano sempre dalla dashboard di Supabase.

## Personalizzazioni

- **Tipologie**: si gestiscono dall'app (solo admin). L'elenco `DEMO_TAGS` in `js/config.js`
  serve solo alla modalità demo.
- **Dimensione massima dei PDF**: `MAX_FILE_MB` in `js/config.js` e `file_size_limit` del
  bucket (Storage → songs → Edit bucket).

## Struttura

```
index.html          pagina dell'app
css/style.css       stile (chiaro/scuro automatico, adatto al telefono)
js/config.js        configurazione Supabase e tipologie
js/app.js           interfaccia
js/backend.js       accesso ai dati (Supabase o demo in memoria)
js/pdf.js           conteggio pagine e unione dei PDF
supabase/schema.sql schema del database e regole di sicurezza
serve.ps1           server locale per provare l'app
```
