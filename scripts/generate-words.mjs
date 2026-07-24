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
const TOTAL_TARGET     = 1000;  // total words to generate
const SUB_BATCH_SIZE   = 100;   // words per API call (keeps response within token limits)
const MAX_TOKENS       = 8000;  // safe ceiling per call

const SYSTEM_PROMPT = `You are a vocabulary curator for a Chinese audience learning English.
Return ONLY a valid JSON array — no prose, no code fences, no extra keys.
Each element must be an object with exactly these keys:
  word (string), difficulty ("beginner"|"intermediate"|"advanced"),
  part_of_speech (e.g. "n.", "v.", "adj.", "adv."),
  source ("learner-list"|"hot-topic"), theme (string|null).
Focus on words useful to Chinese learners: practical everyday vocabulary,
business English, academic words, and currently-discussed terms in tech/culture.`;

function makeUserPrompt(n) {
  return `Generate ${n} diverse, learner-friendly English words.
Mix difficulty levels (≈40% beginner, 40% intermediate, 20% advanced).
For hot-topic words, set source to "hot-topic" and fill theme (e.g. "AI", "climate").
Return the JSON array only.`;
}
// ────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('Error: DEEPSEEK_API_KEY environment variable is not set.');
  process.exit(1);
}

// Parse --batch-size flag (overrides TOTAL_TARGET)
const batchSizeArg = process.argv.indexOf('--batch-size');
const totalTarget = batchSizeArg !== -1 ? parseInt(process.argv[batchSizeArg + 1], 10) : TOTAL_TARGET;

async function fetchBatch(n) {
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
        { role: 'user',   content: makeUserPrompt(n) },
      ],
      temperature: 0.8,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const rawContent = json.choices?.[0]?.message?.content ?? '';

  // DeepSeek may return { words: [...] } or a bare array
  const parsed = JSON.parse(rawContent);
  const arr = Array.isArray(parsed) ? parsed : (parsed.words ?? Object.values(parsed)[0]);
  if (!Array.isArray(arr)) throw new Error('Expected array in response');
  return arr;
}

// Split into sub-batches to avoid truncated JSON
const numBatches = Math.ceil(totalTarget / SUB_BATCH_SIZE);
console.log(`Generating ${totalTarget} words in ${numBatches} batches of ${SUB_BATCH_SIZE}…`);

let allCandidates = [];
for (let i = 0; i < numBatches; i++) {
  const n = Math.min(SUB_BATCH_SIZE, totalTarget - i * SUB_BATCH_SIZE);
  process.stdout.write(`  Batch ${i + 1}/${numBatches} (${n} words)… `);
  try {
    const batch = await fetchBatch(n);
    allCandidates = allCandidates.concat(batch);
    console.log(`got ${batch.length}`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    console.error('Skipping this batch and continuing…');
  }
}

const existing = await readWords(WORDS_PATH);
const { updated, newCount, skippedCount } = mergeWords(existing, allCandidates);
await writeWords(WORDS_PATH, updated);

console.log(`\nDone. ${newCount} new words added, ${skippedCount} skipped as duplicates.`);
console.log(`Total words in queue: ${updated.filter(w => w.status === 'available').length} available.`);
