import { SUPABASE_URL, SUPABASE_ANON_KEY, MAX_FILE_MB, TAGS } from './config.js';
import { createBackend } from './backend.js';
import { countPages, buildPlaylistPdf, openForRender, renderPage } from './pdf.js';

// ---------------------------------------------------------------- Utilità

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Minuscolo e senza accenti, per confronti e ricerca ("perché" trova "perche").
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const tagLabel = (id) => TAGS.find((t) => t.id === id)?.label ?? id;
const byTitle = (a, b) => a.title.localeCompare(b.title, 'it', { sensitivity: 'base' });
// Scalette: prima le più recenti per data, poi quelle senza data in ordine alfabetico.
const byDateThenName = (a, b) => (b.mass_date ?? '').localeCompare(a.mass_date ?? '')
  || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
const shortDate = (iso) => iso.split('-').reverse().join('/');
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const titleFromFileName = (name) => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

function errorText(e) {
  if (e?.code === '23505') return 'Esiste già una scaletta con questo nome.';
  return e?.message || String(e);
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readPdfFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(`"${file.name}" non è un PDF.`);
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${file.name}" supera ${MAX_FILE_MB} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { bytes, pageCount: await countPages(bytes) };
  } catch {
    throw new Error(`"${file.name}" non è un PDF valido oppure è protetto da password.`);
  }
}

function tagChecks(container, name, selected = []) {
  container.innerHTML = TAGS.map((t) => `
    <label><input type="checkbox" name="${name}" value="${t.id}" ${selected.includes(t.id) ? 'checked' : ''}> ${esc(t.label)}</label>
  `).join('');
}
const checkedValues = (container) => [...container.querySelectorAll('input:checked')].map((i) => i.value);

// ---------------------------------------------------------------- Stato

// Con "?demo" nell'indirizzo si prova l'app con dati di esempio, senza toccare quelli veri.
const forceDemo = new URLSearchParams(location.search).has('demo');
const backend = forceDemo ? await createBackend() : await createBackend(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  songs: [],
  playlists: [],
  filter: { words: [], tags: new Set(), mode: 'all' },
  pl: { id: null, name: '', date: '', songIds: [] }, // scaletta aperta
  dirty: false,
};
const pdfCache = new Map(); // file_path -> Uint8Array
const songById = (id) => state.songs.find((s) => s.id === id);

async function getPdf(song) {
  if (!pdfCache.has(song.file_path)) pdfCache.set(song.file_path, await backend.getSongPdf(song));
  return pdfCache.get(song.file_path);
}

// ---------------------------------------------------------------- Login

let loadedFor = null;
async function showUser(user) {
  $('#boot').hidden = true;
  $('#login-view').hidden = !!user;
  $('#app-view').hidden = !user;
  if (!user) {
    loadedFor = null;
    return;
  }
  $('#user-email').textContent = user.email;
  if (loadedFor === user.id) return;
  loadedFor = user.id;
  try {
    await loadAll();
  } catch (e) {
    toast(`Errore nel caricamento dei dati: ${errorText(e)}`, 'error');
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  $('#login-error').textContent = '';
  btn.disabled = true;
  try {
    await backend.signIn(f.email.value.trim(), f.password.value);
    f.password.value = '';
  } catch (err) {
    $('#login-error').textContent = err.message === 'Invalid login credentials'
      ? 'Email o password non corretti.' : errorText(err);
  } finally {
    btn.disabled = false;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  if (state.dirty && !confirm('La scaletta ha modifiche non salvate. Uscire comunque?')) return;
  state.dirty = false;
  await backend.signOut();
});

$('#btn-password').addEventListener('click', () => {
  $('#password-form').reset();
  $('#password-error').textContent = '';
  $('#password-dialog').showModal();
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.pw1.value !== f.pw2.value) {
    $('#password-error').textContent = 'Le due password non coincidono.';
    return;
  }
  try {
    await backend.changePassword(f.pw1.value);
    $('#password-dialog').close();
    toast('Password aggiornata.');
  } catch (err) {
    $('#password-error').textContent = errorText(err);
  }
});

// ---------------------------------------------------------------- Caricamento dati

async function loadAll() {
  const [songs, playlists] = await Promise.all([backend.listSongs(), backend.listPlaylists()]);
  state.songs = songs.sort(byTitle);
  state.playlists = playlists.sort(byDateThenName);
  pdfCache.clear();
  renderSongs();
  renderPlaylistSelect();
  renderPlaylist();
}

// ---------------------------------------------------------------- Archivio canti

$('#tag-filter').innerHTML = TAGS.map((t) =>
  `<button type="button" class="chip" data-tag="${t.id}" aria-pressed="false">${esc(t.label)}</button>`).join('');

$('#tag-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const { tag } = chip.dataset;
  const on = !state.filter.tags.has(tag);
  on ? state.filter.tags.add(tag) : state.filter.tags.delete(tag);
  chip.setAttribute('aria-pressed', on);
  renderSongs();
});

$('#search').addEventListener('input', (e) => {
  state.filter.words = norm(e.target.value).split(/\s+/).filter(Boolean);
  renderSongs();
});

document.querySelectorAll('input[name=tagmode]').forEach((r) => r.addEventListener('change', (e) => {
  state.filter.mode = e.target.value;
  renderSongs();
}));

$('#btn-clear-filters').addEventListener('click', () => {
  state.filter.words = [];
  state.filter.tags.clear();
  $('#search').value = '';
  document.querySelectorAll('#tag-filter .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  renderSongs();
});

function filteredSongs() {
  const { words, tags, mode } = state.filter;
  const wanted = [...tags];
  return state.songs.filter((s) => {
    const t = norm(s.title);
    if (!words.every((w) => t.includes(w))) return false;
    if (!wanted.length) return true;
    return mode === 'all' ? wanted.every((x) => s.tags.includes(x)) : wanted.some((x) => s.tags.includes(x));
  });
}

function renderSongs() {
  const list = filteredSongs();
  const inPlaylist = new Set(state.pl.songIds);
  const total = state.songs.length;
  $('#song-count').textContent = total === 0
    ? 'L\'archivio è vuoto: aggiungi il primo canto.'
    : list.length === total ? `${total} canti` : `${list.length} di ${total} canti`;

  $('#song-list').innerHTML = list.map((s) => `
    <li class="song ${inPlaylist.has(s.id) ? 'in-pl' : ''}" data-id="${s.id}">
      <button type="button" class="add" data-act="add" title="Aggiungi alla scaletta" aria-label="Aggiungi ${esc(s.title)} alla scaletta">+</button>
      <div class="info">
        <span class="title">${esc(s.title)}</span>
        <span class="tags">${s.tags.map((t) => `<span class="tag">${esc(tagLabel(t))}</span>`).join('')}
          ${inPlaylist.has(s.id) ? '<span class="tag here">in scaletta</span>' : ''}</span>
      </div>
      <span class="meta">${s.page_count ?? '?'} pag.</span>
      <div class="row-actions">
        <button type="button" class="ghost" data-act="preview">Apri</button>
        <button type="button" class="ghost" data-act="edit">Modifica</button>
        <button type="button" class="ghost danger" data-act="delete">Elimina</button>
      </div>
    </li>`).join('') || (total ? '<li class="muted empty">Nessun canto corrisponde ai filtri.</li>' : '');
}

$('#song-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const song = songById(btn.closest('li').dataset.id);
  if (!song) return;
  switch (btn.dataset.act) {
    case 'add': return addToPlaylist(song);
    case 'edit': return openSongDialog(song);
    case 'delete': return deleteSong(song);
    case 'preview': return previewSong(song);
  }
});

async function previewSong(song) {
  // La finestra va aperta subito (prima dell'attesa), altrimenti il browser la blocca.
  const win = window.open('about:blank', '_blank');
  try {
    const url = URL.createObjectURL(new Blob([await getPdf(song)], { type: 'application/pdf' }));
    if (win) win.location.href = url;
    else downloadBytes(await getPdf(song), `${song.title}.pdf`);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) {
    win?.close();
    toast(`Impossibile aprire il PDF: ${errorText(e)}`, 'error');
  }
}

async function deleteSong(song) {
  const used = state.playlists.filter((p) => p.song_ids.includes(song.id)).map((p) => p.name);
  const warn = used.length ? `\n\nVerrà tolto anche dalle scalette: ${used.join(', ')}.` : '';
  if (!confirm(`Eliminare definitivamente "${song.title}"?${warn}`)) return;
  try {
    await backend.deleteSong(song);
  } catch (e) {
    return toast(`Eliminazione non riuscita: ${errorText(e)}`, 'error');
  }
  state.songs = state.songs.filter((s) => s.id !== song.id);
  state.playlists.forEach((p) => { p.song_ids = p.song_ids.filter((id) => id !== song.id); });
  state.pl.songIds = state.pl.songIds.filter((id) => id !== song.id);
  pdfCache.delete(song.file_path);
  renderSongs();
  renderPlaylist();
  toast(`"${song.title}" eliminato.`);
}

// ---------------------------------------------------------------- Nuovo / modifica canto

let editingSong = null;
const songForm = $('#song-form');

$('#btn-new-song').addEventListener('click', () => openSongDialog(null));

function openSongDialog(song) {
  editingSong = song;
  songForm.reset();
  $('#song-error').textContent = '';
  $('#song-dialog-title').textContent = song ? 'Modifica canto' : 'Nuovo canto';
  songForm.title.value = song?.title ?? '';
  songForm.file.required = !song;
  $('#song-file-info').textContent = song
    ? `File attuale: ${song.file_name ?? 'PDF'} (${song.page_count ?? '?'} pagine). Scegli un nuovo file solo se vuoi sostituirlo.`
    : '';
  tagChecks($('#song-tags'), 'tag', song?.tags ?? []);
  $('#song-dialog').showModal();
}

songForm.file.addEventListener('change', () => {
  const file = songForm.file.files[0];
  if (file && !songForm.title.value.trim()) songForm.title.value = titleFromFileName(file.name);
});

songForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = songForm.title.value.trim();
  const tags = checkedValues($('#song-tags'));
  const file = songForm.file.files[0] ?? null;
  const submit = songForm.querySelector('[type=submit]');
  $('#song-error').textContent = '';

  const dup = state.songs.find((s) => s.id !== editingSong?.id && norm(s.title) === norm(title));
  if (dup && !confirm(`Esiste già un canto intitolato "${dup.title}". Salvare comunque?`)) return;

  submit.disabled = true;
  submit.textContent = 'Salvataggio…';
  try {
    let pdf = {};
    if (file) pdf = await readPdfFile(file);
    const data = { title, tags, file, bytes: pdf.bytes, pageCount: pdf.pageCount };
    if (editingSong) {
      const updated = await backend.updateSong(editingSong, data);
      if (file) pdfCache.delete(editingSong.file_path);
      state.songs = state.songs.map((s) => (s.id === updated.id ? updated : s));
    } else {
      state.songs.push(await backend.createSong(data));
    }
    state.songs.sort(byTitle);
    $('#song-dialog').close();
    renderSongs();
    renderPlaylist();
    toast(editingSong ? 'Canto aggiornato.' : `"${title}" aggiunto all'archivio.`);
  } catch (err) {
    $('#song-error').textContent = errorText(err);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Salva';
  }
});

// ---------------------------------------------------------------- Importazione multipla

const importForm = $('#import-form');

$('#btn-import').addEventListener('click', () => {
  importForm.reset();
  tagChecks($('#import-tags'), 'tag');
  $('#import-log').innerHTML = '';
  $('#import-dialog').showModal();
});

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const files = [...importForm.files.files];
  const tags = checkedValues($('#import-tags'));
  const skipDup = importForm.skipDup.checked;
  const submit = importForm.querySelector('[type=submit]');
  const log = $('#import-log');
  log.innerHTML = '';
  submit.disabled = true;
  let ok = 0;
  for (const [i, file] of files.entries()) {
    submit.textContent = `Importazione ${i + 1}/${files.length}…`;
    const title = titleFromFileName(file.name);
    const li = document.createElement('li');
    log.append(li);
    try {
      if (skipDup && state.songs.some((s) => norm(s.title) === norm(title))) {
        li.className = 'skip';
        li.textContent = `${title} — già presente, saltato`;
        continue;
      }
      const { bytes, pageCount } = await readPdfFile(file);
      state.songs.push(await backend.createSong({ title, tags, file, bytes, pageCount }));
      li.className = 'ok';
      li.textContent = `${title} — ${pageCount} pag.`;
      ok++;
    } catch (err) {
      li.className = 'err';
      li.textContent = `${file.name} — ${errorText(err)}`;
    }
    li.scrollIntoView({ block: 'nearest' });
  }
  state.songs.sort(byTitle);
  renderSongs();
  submit.disabled = false;
  submit.textContent = 'Importa';
  importForm.files.value = '';
  toast(`${ok} canti importati.`);
});

// ---------------------------------------------------------------- Scaletta

const plName = $('#playlist-name');
const plDate = $('#playlist-date');
const emptyPlaylist = () => ({ id: null, name: '', date: '', songIds: [] });

function markDirty() {
  state.dirty = true;
  renderPlaylist();
}

function addToPlaylist(song) {
  if (state.pl.songIds.includes(song.id)
    && !confirm(`"${song.title}" è già nella scaletta. Aggiungerlo di nuovo?`)) return;
  state.pl.songIds.push(song.id);
  markDirty();
  renderSongs();
}

function openPlaylist(p) {
  state.pl = p
    ? { id: p.id, name: p.name, date: p.mass_date ?? '', songIds: p.song_ids.filter((id) => songById(id)) }
    : emptyPlaylist();
  state.dirty = false;
  renderPlaylistSelect();
  renderPlaylist();
  renderSongs();
}

const confirmDiscard = () => !state.dirty || confirm('La scaletta aperta ha modifiche non salvate. Continuare e perderle?');

function renderPlaylistSelect() {
  const sel = $('#playlist-select');
  sel.innerHTML = `<option value="">${state.playlists.length ? 'Apri scaletta salvata…' : 'Nessuna scaletta salvata'}</option>`
    + state.playlists.map((p) => `<option value="${p.id}">${p.mass_date ? `${shortDate(p.mass_date)} · ` : ''}${esc(p.name)}</option>`).join('');
  sel.value = state.pl.id ?? '';
}

$('#playlist-select').addEventListener('change', (e) => {
  if (!confirmDiscard()) {
    e.target.value = state.pl.id ?? '';
    return;
  }
  openPlaylist(state.playlists.find((p) => p.id === e.target.value));
});

$('#btn-new-playlist').addEventListener('click', () => {
  if (confirmDiscard()) openPlaylist(null);
  plName.focus();
});

// Copia della scaletta aperta, da salvare con un nuovo nome; la data slitta di una settimana.
$('#btn-duplicate-playlist').addEventListener('click', () => {
  const { name, date, songIds } = state.pl;
  state.pl = {
    id: null,
    name: name.trim() ? `${name.trim()} (copia)` : '',
    date: date ? addDays(date, 7) : '',
    songIds: [...songIds],
  };
  state.dirty = true;
  renderPlaylistSelect();
  renderPlaylist();
  renderSongs();
  plName.focus();
  plName.select();
  toast('Copia creata: cambia il nome e salvala.');
});

plName.addEventListener('input', () => {
  state.pl.name = plName.value;
  state.dirty = true;
  renderPlaylistInfo();
});

plDate.addEventListener('change', () => {
  state.pl.date = plDate.value;
  state.dirty = true;
  renderPlaylistInfo();
});

function renderPlaylist() {
  const items = state.pl.songIds.map((id) => songById(id)).filter(Boolean);
  if (plName.value !== state.pl.name) plName.value = state.pl.name;
  if (plDate.value !== state.pl.date) plDate.value = state.pl.date;
  $('#playlist-empty').hidden = items.length > 0;
  $('#playlist-items').innerHTML = items.map((s, i) => `
    <li draggable="true" data-index="${i}">
      <span class="grip" aria-hidden="true">⋮⋮</span>
      <div class="info">
        <span class="title">${esc(s.title)}</span>
        <span class="tags">${s.tags.map((t) => `<span class="tag">${esc(tagLabel(t))}</span>`).join('')}</span>
      </div>
      <div class="row-actions">
        <button type="button" class="ghost icon" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Sposta su">↑</button>
        <button type="button" class="ghost icon" data-act="down" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Sposta giù">↓</button>
        <button type="button" class="ghost icon danger" data-act="remove" aria-label="Togli dalla scaletta">✕</button>
      </div>
    </li>`).join('');
  $('#btn-delete-playlist').hidden = !state.pl.id;
  $('#btn-duplicate-playlist').disabled = items.length === 0;
  $('#btn-download').disabled = items.length === 0;
  $('#btn-preview').disabled = items.length === 0;
  renderPlaylistInfo();
}

function renderPlaylistInfo() {
  const items = state.pl.songIds.map((id) => songById(id)).filter(Boolean);
  const pages = items.reduce((n, s) => n + (s.page_count ?? 0), 0);
  const parts = [];
  if (items.length) parts.push(`${items.length} canti · ${pages} pagine`);
  if (state.dirty) parts.push('<span class="unsaved">● modifiche non salvate</span>');
  else if (state.pl.id) parts.push('salvata');
  $('#playlist-info').innerHTML = parts.join(' · ');
}

function moveItem(from, to) {
  const ids = state.pl.songIds;
  if (to < 0 || to >= ids.length || from === to) return;
  const [x] = ids.splice(from, 1);
  ids.splice(to, 0, x);
  markDirty();
}

$('#playlist-items').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = Number(btn.closest('li').dataset.index);
  if (btn.dataset.act === 'up') moveItem(i, i - 1);
  if (btn.dataset.act === 'down') moveItem(i, i + 1);
  if (btn.dataset.act === 'remove') {
    state.pl.songIds.splice(i, 1);
    markDirty();
    renderSongs();
  }
});

// Trascinamento per riordinare
let dragFrom = null;
const plList = $('#playlist-items');
plList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  dragFrom = Number(li.dataset.index);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragFrom));
  li.classList.add('dragging');
});
plList.addEventListener('dragover', (e) => {
  const li = e.target.closest('li');
  if (dragFrom === null || !li) return;
  e.preventDefault();
  plList.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  li.classList.add('drop-target');
});
plList.addEventListener('drop', (e) => {
  const li = e.target.closest('li');
  if (dragFrom === null || !li) return;
  e.preventDefault();
  moveItem(dragFrom, Number(li.dataset.index));
});
plList.addEventListener('dragend', () => {
  dragFrom = null;
  plList.querySelectorAll('.dragging, .drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target'));
});

$('#btn-save-playlist').addEventListener('click', async () => {
  const name = state.pl.name.trim();
  if (!name) {
    toast('Dai un nome alla scaletta prima di salvarla.', 'error');
    return plName.focus();
  }
  try {
    const saved = await backend.savePlaylist({
      id: state.pl.id, name, mass_date: state.pl.date || null, song_ids: state.pl.songIds,
    });
    state.playlists = [...state.playlists.filter((p) => p.id !== saved.id), saved].sort(byDateThenName);
    state.pl.id = saved.id;
    state.pl.name = saved.name;
    state.dirty = false;
    renderPlaylistSelect();
    renderPlaylist();
    toast(`Scaletta "${saved.name}" salvata.`);
  } catch (e) {
    toast(`Salvataggio non riuscito: ${errorText(e)}`, 'error');
  }
});

$('#btn-delete-playlist').addEventListener('click', async () => {
  if (!state.pl.id || !confirm(`Eliminare la scaletta "${state.pl.name}"? I canti restano nell'archivio.`)) return;
  try {
    await backend.deletePlaylist(state.pl.id);
    state.playlists = state.playlists.filter((p) => p.id !== state.pl.id);
    openPlaylist(null);
    toast('Scaletta eliminata.');
  } catch (e) {
    toast(`Eliminazione non riuscita: ${errorText(e)}`, 'error');
  }
});

// ---------------------------------------------------------------- PDF della scaletta

// Le opzioni restano memorizzate in questo browser.
const OPTIONS_KEY = 'canti-per-la-messa:pdf-options';
const optCover = $('#opt-cover');
const optDropBlack = $('#opt-drop-black');
try {
  const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
  optCover.checked = saved.cover ?? true;
  optDropBlack.checked = saved.dropBlack ?? false;
} catch {
  optCover.checked = true;
}
[optCover, optDropBlack].forEach((el) => el.addEventListener('change', () => {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ cover: optCover.checked, dropBlack: optDropBlack.checked }));
  } catch { /* archivio del browser non disponibile: pazienza */ }
}));

const pdfFileName = () => `${(state.pl.name.trim() || 'Scaletta').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;

// Scarica i PDF dei canti e li unisce; "btn" mostra l'avanzamento.
async function buildPdf(btn) {
  const songs = state.pl.songIds.map((id) => songById(id)).filter(Boolean);
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const items = [];
    for (const [i, s] of songs.entries()) {
      btn.textContent = `Scarico ${i + 1}/${songs.length}…`;
      items.push({ title: s.title, bytes: await getPdf(s) });
    }
    const result = await buildPlaylistPdf(items, {
      title: state.pl.name.trim() || 'Scaletta',
      date: state.pl.date,
      cover: optCover.checked,
      dropFinalBlack: optDropBlack.checked,
      onProgress: (i, n) => { btn.textContent = `Unisco ${i}/${n}…`; },
    });
    if (result.lastNotBlack) toast('L\'ultima pagina dell\'ultimo canto non è nera: è stata lasciata.');
    return result;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('#btn-download').addEventListener('click', async (e) => {
  try {
    const { bytes } = await buildPdf(e.currentTarget);
    downloadBytes(bytes, pdfFileName());
  } catch (err) {
    toast(`Creazione del PDF non riuscita: ${errorText(err)}`, 'error');
  }
});

// Anteprima: miniature di tutte le pagine, disegnate solo quando diventano visibili.
let preview = null; // { bytes, doc, observer }

$('#btn-preview').addEventListener('click', async (e) => {
  let result;
  try {
    result = await buildPdf(e.currentTarget);
  } catch (err) {
    return toast(`Creazione dell'anteprima non riuscita: ${errorText(err)}`, 'error');
  }
  const doc = await openForRender(result.bytes);
  const container = $('#preview-pages');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const canvas = entry.target.querySelector('canvas');
      renderPage(doc, Number(entry.target.dataset.page), canvas, 220)
        .then(() => entry.target.classList.add('ready'))
        .catch(() => {});
    }
  }, { root: $('#preview-dialog'), rootMargin: '300px' });
  preview = { bytes: result.bytes, doc, observer };

  let html = '';
  let group = null;
  result.pages.forEach((p, i) => {
    if (p.group !== group) {
      if (group !== null) html += '</div>';
      group = p.group;
      html += `<h3>${esc(group)}</h3><div class="thumbs">`;
    }
    html += `<figure data-page="${i + 1}"><canvas></canvas><figcaption>${esc(p.label)}</figcaption></figure>`;
  });
  container.innerHTML = `${html}</div>`;
  container.querySelectorAll('figure').forEach((f) => observer.observe(f));

  $('#preview-title').textContent = state.pl.name.trim() || 'Scaletta';
  $('#preview-info').textContent = `${result.pages.length} pagine`
    + (result.droppedBlack ? ' · pagina nera finale tolta' : '');
  $('#preview-dialog').showModal();
  container.scrollTop = 0;
});

$('#btn-preview-download').addEventListener('click', () => {
  if (preview) downloadBytes(preview.bytes, pdfFileName());
});

$('#preview-dialog').addEventListener('close', () => {
  preview?.observer.disconnect();
  preview?.doc.destroy();
  preview = null;
  $('#preview-pages').innerHTML = '';
});

// ---------------------------------------------------------------- Avvio

document.querySelectorAll('dialog [data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

if (backend.mode === 'demo') {
  $('#demo-banner').hidden = false;
  $('#btn-password').hidden = true;
}
backend.onAuthChange(showUser);
showUser(await backend.getUser());
