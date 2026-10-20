// The picture shown when a country's page is shared in a chat app or on social
// media (its og:image): the country's name, key figures and outline, drawn as
// SVG and turned into a 1200×630 PNG by resvg. Used by build_profiles.mjs.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const W = 1200;
const H = 630;
// The site's light colours (src/tokens.css).
const BG = '#f3f1ec';
const TEXT = '#1c1c1a';
const MUTED = '#6b6a64';
const LINE = '#e2ded5';
const SHAPE = '#2f6194';

// ---- Fonts ----------------------------------------------------------------------

// The site's fonts come as WOFF files, which resvg can't read. A WOFF file is a
// TrueType font with each table compressed, so unpack it back into one.
function woffToTtf(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Not a WOFF font');
  const count = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const [offset, packed, size, checksum] = [4, 8, 12, 16].map((o) => woff.readUInt32BE(at + o));
    const raw = woff.subarray(offset, offset + packed);
    tables.push({ tag: woff.subarray(at, at + 4), checksum, data: packed < size ? inflateSync(raw) : raw });
  }
  // The TrueType header and table directory.
  const head = Buffer.alloc(12 + 16 * count);
  woff.copy(head, 0, 4, 8); // the font's own format, kept from the WOFF header
  const power = 2 ** Math.floor(Math.log2(count));
  head.writeUInt16BE(count, 4);
  head.writeUInt16BE(power * 16, 6);
  head.writeUInt16BE(Math.log2(power), 8);
  head.writeUInt16BE(count * 16 - power * 16, 10);
  let offset = head.length;
  const bodies = tables.map((table, i) => {
    table.tag.copy(head, 12 + i * 16);
    head.writeUInt32BE(table.checksum, 16 + i * 16);
    head.writeUInt32BE(offset, 20 + i * 16);
    head.writeUInt32BE(table.data.length, 24 + i * 16);
    const padded = Buffer.alloc(Math.ceil(table.data.length / 4) * 4); // tables start on 4-byte boundaries
    table.data.copy(padded);
    offset += padded.length;
    return padded;
  });
  return Buffer.concat([head, ...bodies]);
}

// resvg only takes fonts as files, so the unpacked fonts are written to the
// (git-ignored) pipeline/build folder.
function fontFiles() {
  const dir = 'pipeline/build/fonts';
  mkdirSync(dir, { recursive: true });
  return [
    '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff',
    '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff',
  ].map((path) => {
    const out = `${dir}/${path.split('/').pop().replace('.woff', '.ttf')}`;
    writeFileSync(out, woffToTtf(readFileSync(`node_modules/${path}`)));
    return out;
  });
}

const FONTS = { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans' };
// (Each font file names its own family; resvg matches the semibold serif only by its full name.)
export const SERIF = `font-family="Source Serif 4 SemiBold"`;
export const SANS = `font-family="IBM Plex Sans"`;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// How wide a line of text is at a font size, in pixels.
export function textWidth(text, font, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="200"><text x="0" y="150" ${font} font-size="${size}">${escape(text)}</text></svg>`;
  return new Resvg(svg, { font: FONTS }).getBBox()?.width ?? 0;
}

// Name lines are this many times the font size apart.
const LEADING = 1.08;

// The name on one line if it fits, otherwise on two, at the largest size that
// fits in `maxWidth` by `maxHeight`.
function fitName(name, maxWidth, maxHeight) {
  const words = name.split(' ');
  const splits = [[name]];
  for (let i = 1; i < words.length; i++) splits.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  for (let size = 84; size >= 40; size -= 4) {
    // Of the ways to break it that fit, the most even one.
    const fits = splits
      .filter((lines) => size * (1 + (lines.length - 1) * LEADING) <= maxHeight)
      .map((lines) => ({ lines, widest: Math.max(...lines.map((l) => textWidth(l, SERIF, size))) }))
      .filter(({ widest }) => widest <= maxWidth)
      .sort((a, b) => a.lines.length - b.lines.length || a.widest - b.widest);
    if (fits.length) return { lines: fits[0].lines, size };
  }
  return { lines: [name], size: 40 };
}

// ---- The country's outline -------------------------------------------------------------

const mercatorY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function bboxOf(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// An SVG path of the country's main land, fitted into the box [x, y, w, h].
// Far-off pieces (French Guiana for France, Alaska for the US) are left out
// so the outline stays big enough to recognise.
function outline(geometry, [bx, by, bw, bh]) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const sized = polygons.map((polygon) => {
    const box = bboxOf(polygon[0]);
    return { polygon, box, area: (box[2] - box[0]) * (box[3] - box[1]) };
  });
  const main = sized.reduce((a, b) => (b.area > a.area ? b : a));
  const centre = (main.box[0] + main.box[2]) / 2;
  // How far beyond the main piece's edges other pieces are kept, in degrees:
  // further for big countries, less for islands, so stray specks don't shrink them.
  const span = Math.max(main.box[2] - main.box[0], main.box[3] - main.box[1]);
  const NEAR = Math.min(12, Math.max(3, span * 1.5));
  const kept = [];
  for (const { polygon, box } of sized) {
    // Pieces across the date line (Russia's far east) move next to the rest.
    const middle = (box[0] + box[2]) / 2;
    const shift = middle - centre > 180 ? -360 : centre - middle > 180 ? 360 : 0;
    const [x0, y0, x1, y1] = [box[0] + shift, box[1], box[2] + shift, box[3]];
    if (x1 < main.box[0] - NEAR || x0 > main.box[2] + NEAR || y1 < main.box[1] - NEAR || y0 > main.box[3] + NEAR) continue;
    kept.push(polygon.map((ring) => ring.map(([lon, lat]) => [lon + shift, -mercatorY(lat)])));
  }
  const all = kept.flat(2);
  const [x0, y0, x1, y1] = bboxOf(all);
  const scale = Math.min(bw / (x1 - x0 || 1), bh / (y1 - y0 || 1));
  const dx = bx + (bw - (x1 - x0) * scale) / 2;
  const dy = by + (bh - (y1 - y0) * scale) / 2;
  return kept
    .flat()
    .map((ring) => `M${ring.map(([x, y]) => `${(dx + (x - x0) * scale).toFixed(1)},${(dy + (y - y0) * scale).toFixed(1)}`).join('L')}Z`)
    .join('');
}

// ---- The picture ---------------------------------------------------------------

// `facts`: up to three [value, label] pairs. `note`: a line under them.
// `footer`: what the site is, along the bottom.
export function previewPng({ name, kicker, facts, note, footer, geometry }) {
  const left = 72;
  const maxWidth = geometry ? 680 : W - 2 * left;
  // Laid out from the bottom up: footer, note, figures, then the name fills
  // the space left between them and the kicker.
  const footerLine = H - 74;
  const noteY = footerLine - 36;
  const labelY = note ? noteY - 50 : noteY;
  const valueY = labelY - 36;
  const nameTop = 200;
  const nameBottom = facts.length ? valueY - 44 - 36 : note ? noteY - 22 - 36 : footerLine - 40;
  const { lines, size } = fitName(name, maxWidth, nameBottom - nameTop);
  const nameSvg = lines
    .map((line, i) => `<text x="${left}" y="${(nameTop + size * (0.8 + i * LEADING)).toFixed(0)}" ${SERIF} font-size="${size}" fill="${TEXT}">${escape(line)}</text>`)
    .join('');
  // Each figure's column is as wide as its value or label, whichever is wider.
  let x = left;
  const factsSvg = facts
    .map(([value, label]) => {
      const svg =
        `<text x="${x}" y="${valueY}" ${SERIF} font-size="44" fill="${TEXT}">${escape(value)}</text>` +
        `<text x="${x}" y="${labelY}" ${SANS} font-size="20" fill="${MUTED}">${escape(label)}</text>`;
      x += Math.max(textWidth(value, SERIF, 44), textWidth(label, SANS, 20)) + 40;
      return svg;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
<text x="${left}" y="98" ${SERIF} font-size="30" fill="${TEXT}">Atlas Meridian</text>
<text x="${left}" y="160" ${SANS} font-size="24" fill="${MUTED}">${escape(kicker)}</text>
${nameSvg}
${factsSvg}
${note ? `<text x="${left}" y="${noteY}" ${SANS} font-size="22" fill="${MUTED}">${escape(note)}</text>` : ''}
${geometry ? `<path d="${outline(geometry, [800, 80, 330, 440])}" fill="${SHAPE}" fill-rule="evenodd"/>` : ''}
<line x1="${left}" x2="${W - left}" y1="${footerLine}" y2="${footerLine}" stroke="${LINE}" stroke-width="2"/>
<text x="${left}" y="${H - 34}" ${SANS} font-size="20" fill="${MUTED}">${escape(footer)}</text>
</svg>`;
  return new Resvg(svg, { font: FONTS, fitTo: { mode: 'width', value: W } }).render().asPng();
}
