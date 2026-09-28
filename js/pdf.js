import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

// Restituisce il numero di pagine; lancia un errore se il file non è un PDF utilizzabile.
export async function countPages(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

// items: [{ title, bytes }] nell'ordine della scaletta.
export async function mergePdfs(items, { title, onProgress } = {}) {
  const out = await PDFDocument.create();
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i, items.length);
    let src;
    try {
      src = await PDFDocument.load(items[i].bytes);
    } catch (e) {
      throw new Error(`Impossibile leggere il PDF di "${items[i].title}": ${e.message}`);
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  onProgress?.(items.length, items.length);
  if (title) out.setTitle(title);
  out.setCreator('Canti per la messa');
  return out.save();
}

// Solo per la modalità demo: crea un PDF segnaposto con N pagine di testo + pagina nera finale.
export async function makeSamplePdf(title, textPages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [w, h] = [960, 540];
  for (let p = 1; p <= textPages; p++) {
    const page = doc.addPage([w, h]);
    page.drawText(title, { x: 60, y: h - 90, size: 36, font: bold, color: rgb(0.1, 0.1, 0.1) });
    for (let l = 0; l < 4; l++) {
      page.drawText(`Testo di esempio - strofa ${p}, riga ${l + 1}`, {
        x: 60, y: h - 170 - l * 50, size: 28, font, color: rgb(0.2, 0.2, 0.2),
      });
    }
    page.drawText(`${p}/${textPages}`, { x: w - 100, y: 30, size: 16, font, color: rgb(0.5, 0.5, 0.5) });
  }
  doc.addPage([w, h]).drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0, 0, 0) });
  return doc.save();
}
