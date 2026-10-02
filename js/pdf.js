import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

// pdf.js (Mozilla) serve solo per disegnare le pagine: anteprima e riconoscimento della pagina nera.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let pdfjsLib;

async function pdfjs() {
  pdfjsLib ??= import(PDFJS).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfjsLib;
}

// Apre un PDF per disegnarne le pagine. Ricordarsi di chiamare destroy() sul risultato.
export async function openForRender(bytes) {
  const lib = await pdfjs();
  return lib.getDocument({ data: bytes.slice() }).promise; // copia: pdf.js si appropria del buffer
}

// Disegna la pagina n (da 1) su canvas, larga "width" pixel.
export async function renderPage(doc, n, canvas, width) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (width * ratio) / base.width });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

// Testo contenuto nel PDF (per la ricerca): una riga per riga di testo, pagine separate da una riga vuota.
export async function extractText(bytes) {
  const doc = await openForRender(bytes);
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      const text = items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  } finally {
    doc.destroy();
  }
}

async function isBlackPage(bytes, index) {
  const doc = await openForRender(bytes);
  try {
    const canvas = document.createElement('canvas');
    await renderPage(doc, index + 1, canvas, 48);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4) < 30;
  } finally {
    doc.destroy();
  }
}

// Restituisce il numero di pagine; lancia un errore se il file non è un PDF utilizzabile.
export async function countPages(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

const formatDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(y, m - 1, d));
};

// I font standard dei PDF non hanno tutti i caratteri (es. emoji): quelli mancanti diventano "?".
const encodable = (font, text) => [...text].map((ch) => {
  try {
    font.encodeText(ch);
    return ch;
  } catch {
    return '?';
  }
}).join('');

function fit(font, text, size, maxWidth) {
  let t = encodable(font, text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

async function drawCover(out, [w, h], { title, date, entries }) {
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const page = out.insertPage(0, [w, h]);
  const margin = Math.min(w, h) * 0.08;
  const maxW = w - 2 * margin;
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.45, 0.45, 0.45);

  let y = h - margin;
  const titleSize = Math.min(h * 0.075, 40);
  y -= titleSize;
  page.drawText(fit(bold, title, titleSize, maxW), { x: margin, y, size: titleSize, font: bold, color: ink });
  if (date) {
    const dateSize = titleSize * 0.5;
    y -= dateSize * 1.6;
    page.drawText(fit(font, formatDate(date), dateSize, maxW), { x: margin, y, size: dateSize, font, color: grey });
  }
  y -= titleSize * 0.6;
  page.drawLine({ start: { x: margin, y }, end: { x: w - margin, y }, thickness: 0.8, color: grey });

  // Elenco dei canti con la pagina di inizio; si restringe per farli stare tutti.
  const avail = y - margin;
  const line = Math.min(h * 0.06, 30, avail / Math.max(entries.length, 1));
  const size = Math.max(line * 0.62, 5);
  const numW = bold.widthOfTextAtSize(`${entries.length}.`, size) + size * 0.6;
  const pageW = font.widthOfTextAtSize('pag. 999', size);
  y -= line * 0.3;
  entries.forEach((e, i) => {
    y -= line;
    page.drawText(`${i + 1}.`, { x: margin, y, size, font: bold, color: grey });
    page.drawText(fit(font, e.title, size, maxW - numW - pageW - size), { x: margin + numW, y, size, font, color: ink });
    const p = `pag. ${e.startPage}`;
    page.drawText(p, { x: w - margin - font.widthOfTextAtSize(p, size), y, size, font, color: grey });
  });
}

// items: [{ title, bytes }] nell'ordine della scaletta.
// Restituisce { bytes, pages: [{ group, label }], droppedBlack, lastNotBlack }.
export async function buildPlaylistPdf(items, { title, date, cover, dropFinalBlack, onProgress } = {}) {
  const out = await PDFDocument.create();
  const sources = [];
  for (const [i, it] of items.entries()) {
    try {
      sources.push(await PDFDocument.load(it.bytes));
    } catch (e) {
      throw new Error(`Impossibile leggere il PDF di "${it.title}": ${e.message}`);
    }
    onProgress?.(i + 1, items.length);
  }

  let droppedBlack = false;
  let lastNotBlack = false;
  const last = sources.at(-1);
  if (dropFinalBlack && last && last.getPageCount() > 1) {
    droppedBlack = await isBlackPage(items.at(-1).bytes, last.getPageCount() - 1);
    lastNotBlack = !droppedBlack;
  }

  const pages = cover ? [{ group: 'Copertina', label: 'Copertina' }] : [];
  const entries = [];
  for (const [i, src] of sources.entries()) {
    let indices = src.getPageIndices();
    if (droppedBlack && i === sources.length - 1) indices = indices.slice(0, -1);
    entries.push({ title: items[i].title, startPage: pages.length + 1 });
    const copied = await out.copyPages(src, indices);
    copied.forEach((p, k) => {
      out.addPage(p);
      pages.push({ group: `${i + 1}. ${items[i].title}`, label: `${k + 1}/${copied.length}` });
    });
  }

  if (cover) {
    // Stesso formato della prima pagina del primo canto (tenendo conto della rotazione).
    const first = sources[0].getPage(0);
    const { width, height } = first.getSize();
    const rotated = first.getRotation().angle % 180 !== 0;
    await drawCover(out, rotated ? [height, width] : [width, height], { title, date, entries });
  }

  if (title) out.setTitle(title);
  out.setCreator('Canti per la messa');
  return { bytes: await out.save(), pages, droppedBlack, lastNotBlack };
}

// Solo per la modalità demo: crea un PDF segnaposto con N pagine di testo + pagina nera finale.
export async function makeSamplePdf(title, textPages = 2, phrase = '') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [w, h] = [960, 540];
  for (let p = 1; p <= textPages; p++) {
    const page = doc.addPage([w, h]);
    page.drawText(title, { x: 60, y: h - 90, size: 36, font: bold, color: rgb(0.1, 0.1, 0.1) });
    for (let l = 0; l < 4; l++) {
      page.drawText(l === 0 && phrase ? phrase : `Testo di esempio - strofa ${p}, riga ${l + 1}`, {
        x: 60, y: h - 170 - l * 50, size: 28, font, color: rgb(0.2, 0.2, 0.2),
      });
    }
    page.drawText(`${p}/${textPages}`, { x: w - 100, y: 30, size: 16, font, color: rgb(0.5, 0.5, 0.5) });
  }
  doc.addPage([w, h]).drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0, 0, 0) });
  return doc.save();
}
