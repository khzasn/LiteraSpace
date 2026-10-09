// Prototipe parser: PDF -> struktur buku {chapters:[{blocks:[...]}]}
// Pakai: node parse.mjs book.pdf out/
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const [, , pdfPath, outDir] = process.argv;
fs.mkdirSync(path.join(outDir, "img"), { recursive: true });
const pdf = await getDocument({
  data: new Uint8Array(fs.readFileSync(pdfPath)),
  useSystemFonts: true,
}).promise;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const mode = (a) => {
  const m = new Map();
  a.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
};
const isItalic = (n) => /italic|oblique|ital\b|-it\b|,it$/i.test(n || "");
const isBold = (n) => /bold|black|heavy|semibold|-bd\b/i.test(n || "");
const ORN = /^[\s□▢◻▪■□�▪]+$/;

// ---------- 1. ekstraksi per halaman ----------
const pages = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList(); // juga memuat font
  const tc = await page.getTextContent();

  const fontName = {};
  const nameOf = (fn) => {
    if (fontName[fn] !== undefined) return fontName[fn];
    let n = "";
    try {
      n = page.commonObjs.get(fn)?.name || "";
    } catch {}
    return (fontName[fn] = n);
  };

  // --- teks -> baris (kelompokkan berdasar baseline y) ---
  const items = tc.items
    .filter((i) => i.str !== undefined && i.str !== "")
    .map((i) => ({
      s: i.str,
      x: i.transform[4],
      y: i.transform[5],
      h: Math.abs(i.transform[3]),
      w: i.width,
      it: isItalic(nameOf(i.fontName)),
      bd: isBold(nameOf(i.fontName)),
    }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const L = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
    if (L) L.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    const real = L.items.filter((i) => i.s.trim());
    if (!real.length) {
      L.empty = true;
      continue;
    }
    L.x0 = real[0].x;
    L.x1 = Math.max(...L.items.map((i) => i.x + i.w));
    // ukuran dominan berdasar jumlah karakter
    const hs = {};
    real.forEach((i) => (hs[i.h] = (hs[i.h] || 0) + i.s.length));
    L.h = +Object.entries(hs).sort((a, b) => b[1] - a[1])[0][0];
    // runs bergaya
    const runs = [];
    for (const i of L.items) {
      const f = (i.it ? "i" : "") + (i.bd ? "b" : "");
      const last = runs[runs.length - 1];
      if (last && last.f === f) last.t += i.s;
      else runs.push({ t: i.s, f });
    }
    L.runs = runs;
    L.text = runs.map((r) => r.t).join("").replace(/\s+/g, " ").trim();
    const nonSp = real.filter((i) => i.s.trim());
    L.allItalic = nonSp.every((i) => i.it);
    L.anyBold = nonSp.some((i) => i.bd);
  }

  // --- gambar: lacak CTM untuk bbox ---
  const mul = (m, c) => [
    m[0] * c[0] + m[1] * c[2],
    m[0] * c[1] + m[1] * c[3],
    m[2] * c[0] + m[3] * c[2],
    m[2] * c[1] + m[3] * c[3],
    m[4] * c[0] + m[5] * c[2] + c[4],
    m[4] * c[1] + m[5] * c[3] + c[5],
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const imgs = [];
  ops.fnArray.forEach((fn, k) => {
    const a = ops.argsArray[k];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(a, ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (a[0]) ctm = mul(a[0], ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      const xs = [0, 1, 0, 1].map((u, j) => {
        const uu = [0, 1, 1, 0][j],
          vv = [0, 0, 1, 1][j];
        return [ctm[0] * uu + ctm[2] * vv + ctm[4], ctm[1] * uu + ctm[3] * vv + ctm[5]];
      });
      const X = xs.map((q) => q[0]),
        Y = xs.map((q) => q[1]);
      imgs.push({
        x0: Math.min(...X),
        x1: Math.max(...X),
        y0: Math.min(...Y),
        y1: Math.max(...Y),
      });
    }
  });
  const bigImgs = imgs.filter((b) => b.x1 - b.x0 >= 50 && b.y1 - b.y0 >= 40);
  const ornImgs = imgs.filter((b) => b.x1 - b.x0 <= 120 && b.y1 - b.y0 <= 26 && b.x1 - b.x0 >= 8);
  pages.push({ p, w: vp.width, h: vp.height, lines: lines.filter((l) => !l.empty), imgs: bigImgs, orns: ornImgs });
}

// ---------- 2. tentukan awal isi (lewati sampul, hak cipta, daftar isi) ----------
let startPage = pages.findIndex((P) =>
  P.lines.some((l) => /^(Prologue|Prolog)$/i.test(l.text) && l.h >= 24)
);
if (startPage < 0) startPage = 0;

// ---------- 3. bangun blok ----------
const chapters = [];
let cur = null;
const newChapter = (kind, label) => {
  cur = { kind, label, title: "", subtitle: "", blocks: [], _hdr: true };
  chapters.push(cur);
};
newChapter("prologue", "");
let pendingPara = null; // paragraf yang bisa tersambung ke halaman berikutnya
const endsSentence = (t) => /[.!?…:”"’)\]]\s*$/.test(t);

const pushPara = (lines, pageNo, indentedStart) => {
  // gabung baris -> runs
  const runs = [];
  lines.forEach((L, idx) => {
    let first = true;
    for (const r of L.runs) {
      let t = r.t.replace(/\s+/g, " ");
      if (first) t = t.replace(/^\s+/, "");
      first = false;
      runs.push({ t, f: r.f });
    }
    // pemisah antar baris
    const last = runs[runs.length - 1];
    const nextL = lines[idx + 1];
    if (nextL) {
      const trimmed = last.t.replace(/\s+$/, "");
      const hyphen = /\w-$/.test(trimmed) && /^[a-zà-ÿ]/.test(nextL.text);
      last.t = trimmed + (hyphen ? "" : " ");
    }
  });
  // satukan run bergaya sama
  const merged = [];
  runs.forEach((r) => {
    const l = merged[merged.length - 1];
    if (l && l.f === r.f) l.t += r.t;
    else merged.push({ ...r });
  });
  const text = merged.map((r) => r.t).join("").trim();
  const allItalic = merged.every((r) => r.f.includes("i") || !r.t.trim());
  return { t: allItalic && text.length < 400 ? "quote" : "p", runs: merged, text, page: pageNo, _lines: lines };
};

const flush = (blk) => {
  cur.blocks.push(blk);
  pendingPara = blk.t === "p" ? blk : null;
};

for (let pi = startPage; pi < pages.length; pi++) {
  const P = pages[pi];
  // buang baris yang berada di dalam bbox gambar (teks bagian dari gambar)
  const inImg = (L) =>
    P.imgs.some(
      (b) =>
        L.y >= b.y0 - 2 &&
        L.y <= b.y1 + 2 &&
        L.x0 >= b.x0 - 5 &&
        (b.x1 - b.x0) * (b.y1 - b.y0) < P.w * P.h * 0.7
    );
  let lines = P.lines.filter((L) => !inImg(L) && !/^[\s—\-–.,]+$/.test(L.text));

  // sisipkan gambar sebagai item alur (berdasar y atas)
  const flow = [
    ...lines.map((L) => ({ k: "line", y: L.y, L })),
    ...P.imgs
      .filter((b) => (b.x1 - b.x0) * (b.y1 - b.y0) < P.w * P.h * 0.7 || P.lines.length < 3)
      .map((b, n) => ({ k: "img", y: b.y1, b, n })),
    ...P.orns.map((b) => ({ k: "orn", y: b.y1 })),
  ].sort((a, b) => b.y - a.y);

  const bodyLines = lines.filter((L) => L.h >= 9 && L.h <= 16 && !ORN.test(L.text));
  const left = mode(bodyLines.map((L) => Math.round(L.x0 / 2) * 2)) ?? 72;
  const maxRight = Math.max(...bodyLines.map((L) => L.x1), 0);
  const gaps = [];
  for (let i = 1; i < bodyLines.length; i++) {
    const g = bodyLines[i - 1].y - bodyLines[i].y;
    if (g > 5 && g < 40) gaps.push(g);
  }
  const lead = median(gaps) || 17;

  // epigraf: gugus 1-3 baris tepat setelah judul bab, dipisah jarak besar dari isi
  if (lines.some((l) => /^CHAPTER\s*\d+$/i.test(l.text))) {
    let lastHead = -1;
    lines.forEach((L, i) => {
      if (L.h >= 16) lastHead = i;
    });
    const cl = [];
    for (let i = lastHead + 1; i < lines.length; i++) {
      if (i === lastHead + 1 || lines[i - 1].y - lines[i].y <= lead * 1.6) cl.push(lines[i]);
      else break;
    }
    if (cl.length && cl.length <= 3 && lastHead + 1 + cl.length < lines.length) cl.forEach((L) => (L._epi = true));
  }

  let buf = []; // baris paragraf berjalan
  let bufIndent = false;
  let bufPage = P.p;
  let prevL = null;
  let firstOnPage = true;
  let headingBuf = null;

  const flushPara = () => {
    if (!buf.length) return;
    const blk = pushPara(buf, bufPage, bufIndent);
    const centered = !!buf[0]._centered;
    if (centered) blk.t = "quote";
    blk._joinPrev = !centered && !!buf._startJoin;
    if (blk._joinPrev && pendingPara && pendingPara.t === "p" && blk.t === "p") {
      const prev = pendingPara;
      const lastRun = prev.runs[prev.runs.length - 1];
      const hy = /\w-$/.test(lastRun.t.trim()) && /^[a-zà-ÿ]/.test(blk.text);
      lastRun.t = lastRun.t.replace(/\s+$/, "") + (hy ? "" : " ");
      blk.runs.forEach((r) => prev.runs.push(r));
      prev.text += " " + blk.text;
      prev.joined = (prev.joined || 0) + 1;
    } else {
      flush(blk);
    }
    buf = [];
  };
  const flushHeading = () => {
    if (!headingBuf) return;
    cur.blocks.push({ t: "h", text: headingBuf.map((l) => l.text).join(" ") });
    pendingPara = null;
    headingBuf = null;
  };

  for (const f of flow) {
    if (f.k === "orn") {
      flushHeading();
      flushPara();
      if (!(cur._hdr && cur.blocks.length === 0)) {
        cur.blocks.push({ t: "orn" });
        pendingPara = null;
      }
      prevL = null;
      continue;
    }
    if (f.k === "img") {
      flushHeading();
      flushPara();
      cur.blocks.push({ t: "img", page: P.p, bbox: f.b, n: f.n, pageW: P.w, pageH: P.h });
      pendingPara = null;
      prevL = null;
      continue;
    }
    const L = f.L;
    const t = L.text;
    const centered =
      L.x0 > left + 45 && Math.abs(L.x0 - left - (maxRight - L.x1)) < 18 && L.x1 < maxRight - 25;

    // ornamen
    if (ORN.test(t)) {
      flushHeading();
      flushPara();
      if (cur._hdr && !cur.blocks.length) cur._orn = true;
      else cur.blocks.push({ t: "orn" });
      pendingPara = null;
      prevL = null;
      firstOnPage = false;
      continue;
    }
    // PART
    if (/^PART\s*[IVX\d]+$/i.test(t.replace(/\s/g, "")) && L.h >= 20) {
      flushHeading();
      flushPara();
      newChapter("part", t.replace(/^PART\s*/i, "PART "));
      cur._hdr = true;
      pendingPara = null;
      firstOnPage = false;
      continue;
    }
    // CHAPTER N
    if (/^CHAPTER\s*\d+$/i.test(t)) {
      flushHeading();
      flushPara();
      newChapter("chapter", t.replace(/^CHAPTER\s*/i, "BAB "));
      pendingPara = null;
      firstOnPage = false;
      continue;
    }
    // judul besar (bab / bagian / prolog)
    if (L.h >= 24 && cur._hdr && cur.blocks.length === 0) {
      flushPara();
      cur.title = (cur.title + " " + t).trim();
      continue;
    }
    if (L.h >= 24 && /^(Prologue|Prolog)$/i.test(t)) {
      cur.title = t;
      continue;
    }
    // subjudul bab/bagian (tepat setelah judul)
    if (cur._hdr && cur.blocks.length === 0 && L.h >= 16 && cur.title && !L.anyBold) {
      cur.subtitle = (cur.subtitle + " " + t).trim();
      continue;
    }
    if (cur._hdr && cur.blocks.length === 0 && cur.kind === "part" && L.h >= 16) {
      cur.subtitle = (cur.subtitle + " " + t).trim();
      continue;
    }
    cur._hdr = false;

    // subjudul dalam bab: besar+bold, atau ALL-CAPS pendek
    const caps = /[A-ZÀ-Þ]{3}/.test(t) && t === t.toUpperCase() && t.length < 90;
    const isHeading = (L.h >= 16.5 && L.anyBold) || (L.h >= 16.5 && caps) || (caps && centered && L.h >= 10);
    if (isHeading) {
      flushPara();
      if (!headingBuf) headingBuf = [];
      headingBuf.push(L);
      prevL = null;
      firstOnPage = false;
      continue;
    } else if (headingBuf) {
      // baris kurung subjudul (mis. "(puncak ketika ...)") ikut judul
      if (/^\(.*\)$/.test(t) && L.h >= 15) {
        headingBuf.push(L);
        continue;
      }
      flushHeading();
    }

    // kutipan tengah (baris terpusat berurutan)
    if ((centered || L._epi) && L.h < 16.5) {
      if (buf.length && !buf[0]._centered) flushPara();
      L._centered = true;
      if (!buf.length) bufPage = P.p;
      buf.push(L);
      prevL = L;
      firstOnPage = false;
      continue;
    }
    if (buf.length && buf[0]._centered) flushPara();

    // paragraf biasa
    const indented = L.x0 > left + 12;
    let newPara = false;
    if (!prevL) newPara = true;
    else {
      const gap = prevL.y - L.y;
      const prevShort = prevL.x1 < maxRight - 0.22 * (maxRight - left) && endsSentence(prevL.text);
      if (indented || gap > lead * 1.35 || prevShort) newPara = true;
    }
    if (newPara) {
      flushPara();
      bufIndent = indented;
      bufPage = P.p;
      const cont =
        firstOnPage &&
        !indented &&
        pendingPara &&
        pendingPara.t === "p" &&
        (!endsSentence(pendingPara.text) || /^[a-zà-ÿ]/.test(t));
      buf._startJoin = !!cont;
    }
    buf.push(L);
    prevL = L;
    firstOnPage = false;
  }
  flushHeading();
  flushPara();
}

// ---------- 4. render & potong gambar ----------
const imgBlocks = chapters.flatMap((c) => c.blocks.filter((b) => b.t === "img"));
const pagesWithImgs = [...new Set(imgBlocks.map((b) => b.page))];
for (const pn of pagesWithImgs) {
  // execSync(`pdftoppm -r 150 -f ${pn} -l ${pn} -png "${pdfPath}" "${outDir}/img/_pg"`);
}
const crops = imgBlocks.map((b) => {
  const s = 150 / 72;
  const pad = 4;
  const x0 = Math.max(0, Math.floor((b.bbox.x0 - pad) * s));
  const x1 = Math.ceil((b.bbox.x1 + pad) * s);
  const y0 = Math.max(0, Math.floor((b.pageH - b.bbox.y1 - pad) * s));
  const y1 = Math.ceil((b.pageH - b.bbox.y0 + pad) * s);
  const name = `p${String(b.page).padStart(2, "0")}_${b.n}.jpg`;
  b.src = `img/${name}`;
  b.w = x1 - x0;
  b.h = y1 - y0;
  return { page: b.page, box: [x0, y0, x1, y1], out: name };
});
fs.writeFileSync(path.join(outDir, "crops.json"), JSON.stringify(crops));

// ---------- 5. rapikan & simpan ----------
chapters.forEach((c, i) => {
  c.id = "c" + i;
  c.blocks.forEach((b) => {
    delete b._lines;
    delete b._joinPrev;
    delete b.bbox;
    delete b.pageW;
    delete b.pageH;
    delete b.n;
    if (b.t === "p" || b.t === "quote") {
      b.runs = b.runs.map((r) => ({ t: r.t.replace(/\s+/g, " "), f: r.f }));
      b.runs[0].t = b.runs[0].t.replace(/^\s+/, "");
      b.runs[b.runs.length - 1].t = b.runs[b.runs.length - 1].t.replace(/\s+$/, "");
      delete b.text;
    }
  });
  delete c._hdr;
  delete c._orn;
});
const book = {
  title: "Think Again (BAB 1-4, versi Indonesia)",
  author: "Adam Grant",
  chapters: chapters.filter((c) => c.title || c.blocks.length),
};
fs.writeFileSync(path.join(outDir, "book.json"), JSON.stringify(book));
const st = {
  chapters: book.chapters.length,
  blocks: book.chapters.reduce((a, c) => a + c.blocks.length, 0),
  paras: book.chapters.reduce((a, c) => a + c.blocks.filter((b) => b.t === "p").length, 0),
  quotes: book.chapters.reduce((a, c) => a + c.blocks.filter((b) => b.t === "quote").length, 0),
  heads: book.chapters.reduce((a, c) => a + c.blocks.filter((b) => b.t === "h").length, 0),
  imgs: imgBlocks.length,
  orn: book.chapters.reduce((a, c) => a + c.blocks.filter((b) => b.t === "orn").length, 0),
};
console.log("startPage", startPage + 1, st);
