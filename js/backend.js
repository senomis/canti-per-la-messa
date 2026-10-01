// Accesso ai dati. Due implementazioni con la stessa interfaccia:
//  - supabaseBackend: database + storage + login su Supabase
//  - demoBackend: tutto in memoria (si perde ricaricando la pagina)

const BUCKET = 'songs';
const newPath = () => `${crypto.randomUUID()}.pdf`;
const ADMIN_ONLY = 'Solo l\'admin può modificare le tipologie.';

// Il ruolo è in app_metadata, che l'utente non può modificare da sé.
const isAdmin = (user) => user?.app_metadata?.role === 'admin';

export async function createBackend(url, key) {
  return url && key ? supabaseBackend(url, key) : demoBackend();
}

async function supabaseBackend(url, key) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(url, key);
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const upload = async (file) => {
    const path = newPath();
    check(await sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' }));
    return path;
  };
  const removeFile = (path) => sb.storage.from(BUCKET).remove([path]);

  return {
    mode: 'supabase',

    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuthChange(cb) {
      // Il callback viene rimandato: chiamare Supabase dentro onAuthStateChange può bloccarsi.
      sb.auth.onAuthStateChange((_event, session) => setTimeout(() => cb(session?.user ?? null)));
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async changePassword(password) {
      check(await sb.auth.updateUser({ password }));
    },
    isAdmin,

    async listTags() {
      return check(await sb.from('tags').select('*').order('position'));
    },
    async createTag(tag) {
      return check(await sb.from('tags').insert(tag).select().single());
    },
    // Se le regole di sicurezza bloccano la modifica, Supabase non dà errore ma 0 righe.
    async updateTag(id, patch) {
      const rows = check(await sb.from('tags').update(patch).eq('id', id).select());
      if (!rows.length) throw new Error(ADMIN_ONLY);
      return rows[0];
    },
    async deleteTag(id) {
      const rows = check(await sb.from('tags').delete().eq('id', id).select());
      if (!rows.length) throw new Error(ADMIN_ONLY);
    },

    async listSongs() {
      return check(await sb.from('songs').select('*'));
    },
    async createSong({ title, tags, file, pageCount }) {
      const path = await upload(file);
      try {
        return check(await sb.from('songs')
          .insert({ title, tags, file_path: path, file_name: file.name, page_count: pageCount })
          .select().single());
      } catch (e) {
        await removeFile(path);
        throw e;
      }
    },
    async updateSong(song, { title, tags, file, pageCount }) {
      const patch = { title, tags };
      if (file) {
        patch.file_path = await upload(file);
        patch.file_name = file.name;
        patch.page_count = pageCount;
      }
      try {
        const row = check(await sb.from('songs').update(patch).eq('id', song.id).select().single());
        if (file) await removeFile(song.file_path);
        return row;
      } catch (e) {
        if (file) await removeFile(patch.file_path);
        throw e;
      }
    },
    async deleteSong(song) {
      check(await sb.from('songs').delete().eq('id', song.id));
      await removeFile(song.file_path);
    },
    async getSongPdf(song) {
      const blob = check(await sb.storage.from(BUCKET).download(song.file_path));
      return new Uint8Array(await blob.arrayBuffer());
    },

    async listPlaylists() {
      return check(await sb.from('playlists').select('*'));
    },
    async savePlaylist({ id, name, mass_date, song_ids }) {
      const row = { name, mass_date, song_ids };
      const q = id
        ? sb.from('playlists').update(row).eq('id', id)
        : sb.from('playlists').insert(row);
      return check(await q.select().single());
    },
    async deletePlaylist(id) {
      check(await sb.from('playlists').delete().eq('id', id));
    },
  };
}

async function demoBackend() {
  const { makeSamplePdf, countPages } = await import('./pdf.js');
  const { DEMO_TAGS } = await import('./config.js');
  const files = new Map();
  let songs = [];
  let playlists = [];
  let tags = DEMO_TAGS.map((t, i) => ({ ...t, position: i + 1 }));
  const clone = (x) => structuredClone(x);
  const now = () => new Date().toISOString();

  const samples = [
    ['Canto di ingresso (esempio)', ['ingresso'], 2],
    ['Alleluia (esempio)', ['vangelo', 'pasquale'], 1],
    ['Offertorio (esempio)', ['offertorio'], 2],
    ['Comunione (esempio)', ['comunione'], 3],
    ['Canto finale (esempio)', ['conclusione'], 2],
    ['Vieni Spirito (esempio)', ['spirito_santo'], 2],
    ['Canto natalizio (esempio)', ['natalizio'], 2],
    ['Canto mariano (esempio)', ['mariano', 'conclusione'], 2],
    ['Canto di Avvento (esempio)', ['avvento', 'ingresso'], 2],
  ];
  for (const [title, tags, pages] of samples) {
    const bytes = await makeSamplePdf(title, pages);
    const file_path = newPath();
    files.set(file_path, bytes);
    songs.push({
      id: crypto.randomUUID(), title, tags, file_path, file_name: `${title}.pdf`,
      page_count: await countPages(bytes), created_at: now(), updated_at: now(),
    });
  }

  // In demo si è admin, così si può provare anche la gestione delle tipologie.
  const demoUser = (email) => ({ id: 'demo', email, app_metadata: { role: 'admin' } });
  let user = demoUser('modalità demo');
  const listeners = [];
  const duplicateLabel = (label, id) => tags.some((t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase());

  return {
    mode: 'demo',
    async getUser() { return user; },
    onAuthChange(cb) { listeners.push(cb); },
    async signIn(email) {
      user = demoUser(email);
      listeners.forEach((cb) => cb(user));
    },
    async signOut() {
      user = null;
      listeners.forEach((cb) => cb(null));
    },
    async changePassword() {},
    isAdmin,

    async listTags() { return clone(tags.sort((a, b) => a.position - b.position)); },
    async createTag(tag) {
      if (tags.some((t) => t.id === tag.id) || duplicateLabel(tag.label)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      tags.push({ ...tag });
      return clone(tag);
    },
    async updateTag(id, patch) {
      if (patch.label && duplicateLabel(patch.label, id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
      const t = tags.find((x) => x.id === id);
      Object.assign(t, patch);
      return clone(t);
    },
    async deleteTag(id) {
      tags = tags.filter((t) => t.id !== id);
      songs.forEach((s) => { s.tags = s.tags.filter((x) => x !== id); });
    },

    async listSongs() { return clone(songs); },
    async createSong({ title, tags, file, bytes, pageCount }) {
      const file_path = newPath();
      files.set(file_path, bytes);
      const song = {
        id: crypto.randomUUID(), title, tags, file_path, file_name: file.name,
        page_count: pageCount, created_at: now(), updated_at: now(),
      };
      songs.push(song);
      return clone(song);
    },
    async updateSong(song, { title, tags, file, bytes, pageCount }) {
      const s = songs.find((x) => x.id === song.id);
      Object.assign(s, { title, tags, updated_at: now() });
      if (file) {
        files.delete(s.file_path);
        s.file_path = newPath();
        s.file_name = file.name;
        s.page_count = pageCount;
        files.set(s.file_path, bytes);
      }
      return clone(s);
    },
    async deleteSong(song) {
      songs = songs.filter((x) => x.id !== song.id);
      files.delete(song.file_path);
      playlists.forEach((p) => { p.song_ids = p.song_ids.filter((id) => id !== song.id); });
    },
    async getSongPdf(song) { return files.get(song.file_path).slice(); },

    async listPlaylists() { return clone(playlists); },
    async savePlaylist({ id, name, mass_date, song_ids }) {
      if (playlists.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      let p = playlists.find((x) => x.id === id);
      if (p) Object.assign(p, { name, mass_date, song_ids, updated_at: now() });
      else playlists.push(p = { id: crypto.randomUUID(), name, mass_date, song_ids, created_at: now(), updated_at: now() });
      return clone(p);
    },
    async deletePlaylist(id) { playlists = playlists.filter((p) => p.id !== id); },
  };
}
