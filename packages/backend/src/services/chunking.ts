export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

/**
 * Teilt Text in überlappende Chunks für die Vektor-Indexierung. Bevorzugt
 * Satzgrenzen; übergroße Einzelsätze werden hart geschnitten. Überlappung
 * erhält Kontext über Chunk-Grenzen hinweg (bessere Retrieval-Qualität).
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = Math.max(200, opts.maxChars ?? 1000);
  const overlap = Math.min(Math.max(0, opts.overlap ?? 150), Math.floor(maxChars / 2));

  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = splitSentences(clean);
  const chunks: string[] = [];
  let cur = '';

  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (const piece of hardSlice(s, maxChars, overlap)) chunks.push(piece);
      continue;
    }
    if (cur && cur.length + 1 + s.length > maxChars) {
      chunks.push(cur);
      // Überlappung voranstellen – aber nur, wenn der harte Längen-Cap erhalten bleibt
      const pre = overlap > 0 ? tailChars(cur, overlap) : '';
      cur = pre && pre.length + 1 + s.length <= maxChars ? `${pre} ${s}` : s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

function splitSentences(text: string): string[] {
  // nach Satzende-Zeichen + Whitespace trennen (Node-20-Lookbehind)
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hardSlice(s: string, maxChars: number, overlap: number): string[] {
  const step = Math.max(1, maxChars - overlap);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += step) {
    out.push(s.slice(i, i + maxChars).trim());
    if (i + maxChars >= s.length) break;
  }
  return out.filter(Boolean);
}

function tailChars(s: string, n: number): string {
  if (s.length <= n) return s;
  const tail = s.slice(s.length - n);
  // an Wortgrenze beginnen
  const sp = tail.indexOf(' ');
  return sp > 0 ? tail.slice(sp + 1) : tail;
}
