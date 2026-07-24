import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Read and parse `data/words.json` (or a custom path for tests).
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
export async function readWords(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Atomically write words array to filePath (write temp → rename).
 * @param {string} filePath
 * @param {Array} words
 */
export async function writeWords(filePath, words) {
  const tmp = join(tmpdir(), `words-${randomBytes(6).toString('hex')}.json`);
  await writeFile(tmp, JSON.stringify(words, null, 2) + '\n', 'utf8');
  await rename(tmp, filePath);
}

/**
 * Return the oldest `available` word by `added_at` (FIFO), or null if none.
 * @param {Array} words
 * @returns {object|null}
 */
export function selectNextWord(words) {
  const available = words
    .filter(w => w.status === 'available')
    .sort((a, b) => a.added_at.localeCompare(b.added_at));
  return available[0] ?? null;
}

/**
 * Merge candidate objects into existing words array (additive, dedup by word, case-insensitive).
 * Candidates must have: word, difficulty, part_of_speech, source, theme.
 * @param {Array} existing
 * @param {Array} candidates  — plain objects from DeepSeek, no status/dates
 * @returns {{ updated: Array, newCount: number, skippedCount: number }}
 */
export function mergeWords(existing, candidates) {
  const seen = new Set(existing.map(w => w.word.toLowerCase()));
  let newCount = 0;
  let skippedCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const c of candidates) {
    if (seen.has(c.word.toLowerCase())) {
      skippedCount++;
      continue;
    }
    seen.add(c.word.toLowerCase());
    newCount++;
    existing.push({
      word: c.word,
      status: 'available',
      difficulty: c.difficulty,
      part_of_speech: c.part_of_speech,
      source: c.source ?? 'learner-list',
      theme: c.theme ?? null,
      added_at: today,
      published_at: null,
      article_path: null,
    });
  }

  return { updated: existing, newCount, skippedCount };
}
