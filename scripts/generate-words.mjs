#!/usr/bin/env node
/**
 * Replenishes data/words.json using the DeepSeek API.
 * Requires env var: DEEPSEEK_API_KEY
 *
 * Usage: node scripts/generate-words.mjs [--batch-size N]
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWords, writeWords, mergeWords } from './lib/words.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_PATH = resolve(__dirname, '../data/words.json');

// ── Tuneable constants ───────────────────────────────────────────────────────
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL   = 'deepseek-chat';
const BATCH_SIZE       = 1000;

const SYSTEM_PROMPT = `You are a vocabulary curator for a Chinese audience learning English.
Return ONLY a valid JSON array — no prose, no code fences, no extra keys.
Each element must be an object with exactly these keys:
  word (string), difficulty ("beginner"|"intermediate"|"advanced"),
  part_of_speech (e.g. "n.", "v.", "adj.", "adv."),
  source ("learner-list"|"hot-topic"), theme (string|null).
Focus on words useful to Chinese learners: practical everyday vocabulary,
business English, academic words, and currently-discussed terms in tech/culture.`;

const USER_PROMPT = `Generate ${BATCH_SIZE} diverse, learner-friendly English words.
Mix difficulty levels (≈40% beginner, 40% intermediate, 20% advanced).
For hot-topic words, set source to "hot-topic" and fill theme (e.g. "AI", "climate").
Return the JSON array only.`;
// ────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('Error: DEEPSEEK_API_KEY environment variable is not set.');
  process.exit(1);
}

// Parse --batch-size flag
const batchSizeArg = process.argv.indexOf('--batch-size');
const batchSize = batchSizeArg !== -1 ? parseInt(process.argv[batchSizeArg + 1], 10) : BATCH_SIZE;

console.log(`Calling DeepSeek API (batch size: ${batchSize})…`);

const res = await fetch(DEEPSEEK_API_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: USER_PROMPT.replace(BATCH_SIZE.toString(), batchSize.toString()) },
    ],
    temperature: 0.8,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
  }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`DeepSeek API error ${res.status}: ${body}`);
  process.exit(1);
}

const json = await res.json();
const rawContent = json.choices?.[0]?.message?.content ?? '';

let candidates;
try {
  // DeepSeek may return { words: [...] } or a bare array
  const parsed = JSON.parse(rawContent);
  candidates = Array.isArray(parsed) ? parsed : (parsed.words ?? Object.values(parsed)[0]);
  if (!Array.isArray(candidates)) throw new Error('Expected array');
} catch (err) {
  console.error('Failed to parse DeepSeek response as JSON array:', err.message);
  console.error('Raw content:', rawContent.slice(0, 500));
  process.exit(1);
}

const existing = await readWords(WORDS_PATH);
const { updated, newCount, skippedCount } = mergeWords(existing, candidates);
await writeWords(WORDS_PATH, updated);

console.log(`Done. ${newCount} new words added, ${skippedCount} skipped as duplicates.`);
console.log(`Total words in queue: ${updated.filter(w => w.status === 'available').length} available.`);
