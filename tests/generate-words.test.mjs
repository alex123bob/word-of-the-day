import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readWords, selectNextWord, mergeWords } from '../scripts/lib/words.mjs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE = [
  { word: 'apple',  status: 'published', difficulty: 'beginner',     part_of_speech: 'n.', source: 'learner-list', theme: null, added_at: '2026-01-01', published_at: '2026-01-02', article_path: 'articles/2026-01-02-apple.md' },
  { word: 'banana', status: 'available', difficulty: 'beginner',     part_of_speech: 'n.', source: 'learner-list', theme: null, added_at: '2026-01-02', published_at: null,          article_path: null },
  { word: 'Cherry', status: 'available', difficulty: 'intermediate', part_of_speech: 'n.', source: 'learner-list', theme: null, added_at: '2026-01-03', published_at: null,          article_path: null },
];

test('selectNextWord — returns oldest available (FIFO by added_at)', () => {
  const word = selectNextWord(FIXTURE);
  assert.equal(word.word, 'banana');
});

test('selectNextWord — returns null when no available words', () => {
  const allPublished = FIXTURE.map(w => ({ ...w, status: 'published' }));
  const word = selectNextWord(allPublished);
  assert.equal(word, null);
});

test('mergeWords — appends new words, skips duplicates (case-insensitive)', () => {
  const existing = structuredClone(FIXTURE);
  const candidates = [
    { word: 'cherry', difficulty: 'intermediate', part_of_speech: 'n.', source: 'learner-list', theme: null }, // dup
    { word: 'date',   difficulty: 'beginner',     part_of_speech: 'n.', source: 'learner-list', theme: null }, // new
  ];
  const { updated, newCount, skippedCount } = mergeWords(existing, candidates);
  assert.equal(newCount, 1);
  assert.equal(skippedCount, 1);
  assert.equal(updated.length, 4);
  assert.equal(updated.find(w => w.word === 'date').status, 'available');
});

test('mergeWords — never overwrites an existing available word', () => {
  const existing = structuredClone(FIXTURE);
  const candidates = [
    { word: 'banana', difficulty: 'advanced', part_of_speech: 'n.', source: 'learner-list', theme: null },
  ];
  const { updated } = mergeWords(existing, candidates);
  const banana = updated.find(w => w.word === 'banana');
  assert.equal(banana.difficulty, 'beginner'); // unchanged
});

test('readWords — reads a JSON file from disk', async () => {
  const tmp = join(tmpdir(), `words-test-${Date.now()}.json`);
  await writeFile(tmp, JSON.stringify(FIXTURE), 'utf8');
  const words = await readWords(tmp);
  assert.equal(words.length, 3);
  await unlink(tmp);
});
