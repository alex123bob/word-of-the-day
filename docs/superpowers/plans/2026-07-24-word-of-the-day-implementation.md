# Word of the Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js pipeline that generates hero-card PNGs, downloads Bilibili thumbnails, and replenishes the word queue via DeepSeek — all driven by Claude Code for the daily article flow and GitHub Actions for unattended word replenishment.

**Architecture:** Claude Code drives the daily article session (picks word, searches Bilibili, writes content, calls wenyan-mcp to push to WeChat draft). Three deterministic helper scripts handle non-agentic steps: thumbnail download, card rendering (Playwright/Chromium), and word-list generation (DeepSeek API). A GitHub Actions workflow replenishes words automatically when the queue drops below 30.

**Tech Stack:** Node.js ≥ 20.12 (ESM), Playwright (Chromium), DeepSeek API (OpenAI-compatible), wenyan-mcp MCP server, bilibili-mcp-js MCP server, GitHub Actions CI.

---

## File Map

| Path | Role |
|------|------|
| `package.json` | Project manifest, dependencies, scripts |
| `.mcp.json` | MCP server registrations for Claude Code |
| `data/words.json` | Word queue — single source of truth |
| `scripts/generate-words.mjs` | DeepSeek API → appends words to `data/words.json` |
| `scripts/download-thumbnail.mjs` | Downloads one Bilibili `pic` URL to `articles/assets/` |
| `scripts/render-card.mjs` | Renders hero card HTML → PNG via Playwright |
| `scripts/lib/words.mjs` | Shared word-queue helpers (read, select, write-atomic) |
| `scripts/templates/card-confusion.html` | HTML template for confusion-pair card variant |
| `scripts/templates/card-phrase.html` | HTML template for top-phrase card variant |
| `scripts/templates/card.css` | Shared card CSS (colors, typography, layout) |
| `.github/workflows/replenish-words.yml` | Scheduled CI: replenish when queue < 30 |
| `tests/generate-words.test.mjs` | Unit tests: merge logic + word-selection |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.mcp.json`
- Create: `data/words.json`
- Create: `articles/assets/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "word-of-the-day",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20.12" },
  "scripts": {
    "generate-words": "node scripts/generate-words.mjs",
    "render-card": "node scripts/render-card.mjs",
    "download-thumbnail": "node scripts/download-thumbnail.mjs",
    "test": "node --test tests/*.test.mjs"
  },
  "dependencies": {
    "playwright": "^1.45.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created.

- [ ] **Step 3: Install Playwright's Chromium browser**

Run: `npx playwright install chromium`
Expected: Chromium downloaded to local cache, ends with "Chromium ... is already installed" or download progress.

- [ ] **Step 4: Create `.mcp.json`**

```json
{
  "mcpServers": {
    "wenyan": {
      "command": "npx",
      "args": ["-y", "@wenyan-md/mcp"],
      "env": {
        "WECHAT_APP_ID": "${WECHAT_APP_ID}",
        "WECHAT_APP_SECRET": "${WECHAT_APP_SECRET}"
      }
    },
    "bilibili": {
      "command": "npx",
      "args": ["-y", "bilibili-mcp-js"]
    }
  }
}
```

- [ ] **Step 5: Create `data/words.json` with initial seed word**

```json
[
  {
    "word": "resilient",
    "status": "available",
    "difficulty": "intermediate",
    "part_of_speech": "adj.",
    "source": "learner-list",
    "theme": null,
    "added_at": "2026-07-24",
    "published_at": null,
    "article_path": null
  }
]
```

- [ ] **Step 6: Create `articles/assets/.gitkeep`**

Create an empty file at `articles/assets/.gitkeep` so git tracks the directory.

- [ ] **Step 7: Update `.gitignore`**

Add these lines to `.gitignore`:
```
articles/assets/*.png
articles/assets/*.jpg
articles/assets/*.jpeg
articles/assets/*.webp
```
(Keep `.gitkeep` tracked but ignore downloaded thumbnails and rendered PNGs.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .mcp.json data/words.json articles/ .gitignore
git commit -m "feat: project scaffold — package.json, MCP config, word queue seed"
```

---

## Task 2: Shared word-queue library

**Files:**
- Create: `scripts/lib/words.mjs`

- [ ] **Step 1: Write the failing test for `readWords`, `selectNextWord`, `mergeWords`**

Create `tests/generate-words.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `node --test tests/generate-words.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` or `FAIL` — `scripts/lib/words.mjs` doesn't exist yet.

- [ ] **Step 3: Implement `scripts/lib/words.mjs`**

Create `scripts/lib/words.mjs`:

```js
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `node --test tests/generate-words.test.mjs`
Expected: all 5 tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/words.mjs tests/generate-words.test.mjs
git commit -m "feat: word-queue library (readWords, writeWords, selectNextWord, mergeWords) + tests"
```

---

## Task 3: `scripts/download-thumbnail.mjs`

**Files:**
- Create: `scripts/download-thumbnail.mjs`

- [ ] **Step 1: Create `scripts/download-thumbnail.mjs`**

```js
#!/usr/bin/env node
/**
 * Usage: node scripts/download-thumbnail.mjs <url> <dest>
 * Downloads <url> to <dest>. Exits 0 on success, 1 on failure.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const [,, url, dest] = process.argv;

if (!url || !dest) {
  console.error('Usage: node scripts/download-thumbnail.mjs <url> <dest>');
  process.exit(1);
}

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url, {
    headers: {
      // Bilibili requires a Referer to serve image CDN assets
      'Referer': 'https://www.bilibili.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; word-of-the-day/1.0)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

try {
  await download(url, dest);
  console.log(`Downloaded: ${dest}`);
} catch (err) {
  console.error(`Download failed: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Smoke-test manually**

Run (use any real Bilibili thumbnail URL, or a public image):
```bash
node scripts/download-thumbnail.mjs \
  "https://i0.hdslb.com/bfs/archive/example.jpg" \
  "articles/assets/test-thumb.jpg"
```
Expected: file appears at `articles/assets/test-thumb.jpg`, script exits 0.

If Bilibili 403s in test: use any public JPEG URL to verify the plumbing works (e.g. `https://httpbin.org/image/jpeg`).

- [ ] **Step 3: Commit**

```bash
git add scripts/download-thumbnail.mjs
git commit -m "feat: download-thumbnail script — fetches Bilibili pic URLs to articles/assets/"
```

---

## Task 4: Hero card templates and CSS

**Files:**
- Create: `scripts/templates/card.css`
- Create: `scripts/templates/card-confusion.html`
- Create: `scripts/templates/card-phrase.html`

- [ ] **Step 1: Create `scripts/templates/card.css`**

```css
/* Noto Sans SC for CJK, Inter for Latin — both served from Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+SC:wght@400;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #FAF7F2;
  --primary:     #1A1A1A;
  --secondary:   #666666;
  --accent:      #C97A5A;
  --font-latin:  'Inter', sans-serif;
  --font-cjk:    'Noto Sans SC', sans-serif;
}

body {
  background: var(--bg);
  color: var(--primary);
  font-family: var(--font-latin);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 0;
  overflow: hidden;
}

.card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 15% 10%;
  text-align: center;
}

.word {
  font-size: clamp(48px, 8vw, 80px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--primary);
}

.hook {
  margin-top: 0.6em;
  font-size: clamp(18px, 3vw, 28px);
  font-weight: 400;
  color: var(--secondary);
  font-family: var(--font-cjk);
  line-height: 1.5;
  max-width: 80%;
}

.accent-line {
  width: 48px;
  height: 3px;
  background: var(--accent);
  margin: 1em auto;
  border-radius: 2px;
}

/* Confusion-pair layout */
.pair {
  display: flex;
  gap: 1.5em;
  align-items: center;
  margin-top: 0.8em;
}
.pair-word {
  font-size: clamp(28px, 5vw, 52px);
  font-weight: 700;
  color: var(--primary);
}
.pair-separator {
  font-size: clamp(18px, 3vw, 28px);
  color: var(--secondary);
}
.pair-gloss {
  font-size: clamp(14px, 2.5vw, 20px);
  color: var(--secondary);
  font-family: var(--font-cjk);
  margin-top: 0.4em;
  line-height: 1.4;
}
```

- [ ] **Step 2: Create `scripts/templates/card-confusion.html`**

This template receives template-literal replacements for `{{WORD_A}}`, `{{WORD_B}}`, `{{GLOSS_A}}`, `{{GLOSS_B}}`.

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800, initial-scale=1">
  <link rel="stylesheet" href="./card.css">
  <style>
    body { width: 800px; height: 340px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="pair">
      <span class="pair-word">{{WORD_A}}</span>
      <span class="pair-separator">vs</span>
      <span class="pair-word">{{WORD_B}}</span>
    </div>
    <div class="pair-gloss">用 {{WORD_A}} 表示{{GLOSS_A}}；用 {{WORD_B}} 表示{{GLOSS_B}}</div>
    <div class="accent-line"></div>
  </div>
</body>
</html>
```

- [ ] **Step 3: Create `scripts/templates/card-phrase.html`**

Template placeholders: `{{WORD}}`, `{{PHRASE}}`, `{{HOOK}}`.

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800, initial-scale=1">
  <link rel="stylesheet" href="./card.css">
  <style>
    body { width: 800px; height: 340px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="word">{{WORD}}</div>
    <div class="accent-line"></div>
    <div class="hook">{{PHRASE}}</div>
    <div class="hook" style="font-size: clamp(14px, 2.2vw, 20px); margin-top: 0.4em; color: #888;">{{HOOK}}</div>
  </div>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/templates/
git commit -m "feat: hero card HTML/CSS templates (confusion-pair + phrase variants)"
```

---

## Task 5: `scripts/render-card.mjs`

**Files:**
- Create: `scripts/render-card.mjs`

- [ ] **Step 1: Create `scripts/render-card.mjs`**

```js
#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/render-card.mjs confusion <wordA> <wordB> <glossA> <glossB> <dest>
 *   node scripts/render-card.mjs phrase <word> <phrase> <hook> <dest>
 *
 * Renders the appropriate hero card template to a PNG at <dest>.
 * Also renders a 600×600 square variant at <dest-without-ext>-square.png.
 */
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, 'templates');

const [,, variant, ...rest] = process.argv;

if (!['confusion', 'phrase'].includes(variant)) {
  console.error('Usage: node scripts/render-card.mjs confusion|phrase ...');
  process.exit(1);
}

function applyTemplate(html, replacements) {
  let out = html;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  return out;
}

async function renderCard(htmlContent, dest, { width, height }) {
  await mkdir(dirname(dest), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  await page.screenshot({ path: dest, fullPage: false });
  await browser.close();
}

let replacements, dest, templateFile;

if (variant === 'confusion') {
  const [wordA, wordB, glossA, glossB, destArg] = rest;
  if (!wordA || !wordB || !glossA || !glossB || !destArg) {
    console.error('confusion: requires wordA wordB glossA glossB dest');
    process.exit(1);
  }
  replacements = { WORD_A: wordA, WORD_B: wordB, GLOSS_A: glossA, GLOSS_B: glossB };
  dest = destArg;
  templateFile = 'card-confusion.html';
} else {
  const [word, phrase, hook, destArg] = rest;
  if (!word || !phrase || !hook || !destArg) {
    console.error('phrase: requires word phrase hook dest');
    process.exit(1);
  }
  replacements = { WORD: word, PHRASE: phrase, HOOK: hook };
  dest = destArg;
  templateFile = 'card-phrase.html';
}

const templatePath = join(TEMPLATES_DIR, templateFile);
const rawHtml = await readFile(templatePath, 'utf8');
const html = applyTemplate(rawHtml, replacements);

// Wide variant (WeChat cover: 800×340)
await renderCard(html, dest, { width: 800, height: 340 });
console.log(`Rendered wide card: ${dest}`);

// Square variant (600×600 for social repost)
const squareDest = dest.replace(/\.png$/, '-square.png');
const squareHtml = html.replace(
  'body { width: 800px; height: 340px; }',
  'body { width: 600px; height: 600px; }'
);
await renderCard(squareHtml, squareDest, { width: 600, height: 600 });
console.log(`Rendered square card: ${squareDest}`);
```

- [ ] **Step 2: Smoke-test — confusion variant**

Run:
```bash
node scripts/render-card.mjs confusion \
  "affect" "effect" \
  "动词，表示影响" "名词，表示结果" \
  "articles/assets/test-confusion.png"
```
Expected: `articles/assets/test-confusion.png` and `articles/assets/test-confusion-square.png` created. Open and eyeball — warm off-white background, "affect vs effect" in bold, gloss text below.

- [ ] **Step 3: Smoke-test — phrase variant**

Run:
```bash
node scripts/render-card.mjs phrase \
  "resilient" \
  "bounce back from adversity" \
  "逆境中恢复的能力" \
  "articles/assets/test-phrase.png"
```
Expected: `articles/assets/test-phrase.png` and `articles/assets/test-phrase-square.png` created. Open and eyeball — word large and centered, phrase below.

- [ ] **Step 4: Commit**

```bash
git add scripts/render-card.mjs
git commit -m "feat: render-card script — Playwright/Chromium → PNG (wide + square variants)"
```

---

## Task 6: `scripts/generate-words.mjs`

**Files:**
- Create: `scripts/generate-words.mjs`

- [ ] **Step 1: Create `scripts/generate-words.mjs`**

```js
#!/usr/bin/env node
/**
 * Replenishes data/words.json using the DeepSeek API.
 * Requires env var: DEEPSEEK_API_KEY
 *
 * Usage: node scripts/generate-words.mjs [--batch-size N]
 */
import { readFile } from 'node:fs/promises';
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
```

- [ ] **Step 2: Test with a small batch (requires `DEEPSEEK_API_KEY` in env)**

Run:
```bash
DEEPSEEK_API_KEY=<your-key> node scripts/generate-words.mjs --batch-size 5
```
Expected output like:
```
Calling DeepSeek API (batch size: 5)…
Done. 4 new words added, 1 skipped as duplicates.
Total words in queue: 5 available.
```
And `data/words.json` grows by ~4 new entries (the seed word "resilient" may be skipped as a dup).

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-words.mjs
git commit -m "feat: generate-words script — DeepSeek API → merges into data/words.json"
```

---

## Task 7: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/replenish-words.yml`

- [ ] **Step 1: Create `.github/workflows/replenish-words.yml`**

```yaml
name: Replenish word queue

on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily (10:00 CST)
  workflow_dispatch:        # allow manual trigger

jobs:
  replenish:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # needed to commit updated words.json

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci --ignore-scripts

      - name: Count available words
        id: count
        run: |
          count=$(node -e "
            const data = JSON.parse(require('fs').readFileSync('data/words.json','utf8'));
            console.log(data.filter(w=>w.status==='available').length);
          ")
          echo "available=$count" >> "$GITHUB_OUTPUT"
          echo "Available words: $count"

      - name: Replenish if below threshold
        if: ${{ fromJson(steps.count.outputs.available) < 30 }}
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
        run: node scripts/generate-words.mjs

      - name: Commit updated word list
        if: ${{ fromJson(steps.count.outputs.available) < 30 }}
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/words.json
          git diff --cached --quiet || git commit -m "chore(ci): replenish word queue [skip ci]"
          git push
```

- [ ] **Step 2: Add `DEEPSEEK_API_KEY` to GitHub repo secrets**

In the GitHub UI: Settings → Secrets and variables → Actions → New repository secret.
Name: `DEEPSEEK_API_KEY`. Value: your DeepSeek API key.

- [ ] **Step 3: Test workflow manually**

Trigger via GitHub UI: Actions → "Replenish word queue" → Run workflow.
Expected: workflow runs, if queue < 30 it calls DeepSeek and commits.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/replenish-words.yml
git commit -m "feat: GitHub Actions — daily word-queue replenishment workflow"
```

---

## Task 8: Claude Code daily-flow skill

**Files:**
- Create: `.opencode/skills/daily-article/SKILL.md` (or `.claude/commands/daily-article.md` — whichever Claude Code uses in this repo)

This step creates the skill/slash-command that Claude Code invokes each day to drive the article flow. The content is a structured prompt — not executable code.

- [ ] **Step 1: Create `.opencode/skills/daily-article/SKILL.md`**

```markdown
# Daily Article Flow

Runs the full word-of-the-day article pipeline. Execute each step in order.

## Step 1 — Pick the word

Read `data/words.json`. Find the oldest entry with `status: "available"` (sort by `added_at`, FIFO).

If none are available:
- Tell the user: "No available words. Run `node scripts/generate-words.mjs` or trigger the GitHub Actions replenishment workflow."
- Stop.

## Step 2 — Find Bilibili clips

Call the `bilibili` MCP server's `searchBilibili` tool with the word as the keyword.
Review results for relevance: prefer clips where the word appears in natural dialogue (movies, TV shows, cartoons, vlogs) over unrelated results. Rank by relevance × view count.
Pick the best 1–3 clips. If nothing suitable, proceed without clips and note the omission.

## Step 3 — Download thumbnails

For each selected clip's `pic` URL, run:
```bash
node scripts/download-thumbnail.mjs "<pic_url>" "articles/assets/<bvid>.jpg"
```
A failed download degrades that clip to a plain text link — do not stop.

## Step 4 — Write article content

Write the word's content (in Chinese, as per the article structure). Choose the hero hook:
- **Confusion pair** — if the word has a notable easily-confused counterpart (e.g. affect/effect).
- **Top phrase** — if a common phrase is the word's most useful takeaway.

Return both the hook choice (confusion|phrase) and the hero hook data.

## Step 5 — Render hero card

Run the appropriate render command:

**Confusion pair:**
```bash
node scripts/render-card.mjs confusion "<wordA>" "<wordB>" "<glossA_zh>" "<glossB_zh>" "articles/assets/<date>-<word>-card.png"
```

**Top phrase:**
```bash
node scripts/render-card.mjs phrase "<word>" "<phrase>" "<hook_zh>" "articles/assets/<date>-<word>-card.png"
```

If the render fails, surface the error and stop. Do NOT continue without the hero card.

## Step 6 — Assemble Markdown

Write the article `.md` file at `articles/YYYY-MM-DD-<word>.md`:

```markdown
---
title: 每日一词 | <word>
cover: articles/assets/<date>-<word>-card.png
author: <author>
---

![<word>](articles/assets/<date>-<word>-card.png)

## 真实语境（B站视频）

<!-- For each selected clip: -->
[![<video title>](articles/assets/<bvid>.jpg)](<arcurl>)
**<video title>** · <play> 次播放
> 这个片段展示了「<word>」的用法：<one line on how the word appears>

## 单词

**<word>** /US phonetics/ /UK phonetics/
<one-line core meaning in Chinese>

## 基本释义

<!-- definitions by part of speech, each with English example + Chinese gloss -->

## 常见搭配 / 短语

<!-- collocations and phrases -->

## 常见用法

<!-- concise usage notes: register, patterns, nuances -->

## 易混词辨析

<!-- comparison with easily-confused words; "用 X 表示…，用 Y 表示…" -->

## 一点趣味

<!-- etymology, cultural note, or word family — whichever is most memorable; 2–3 lines max -->
```

## Step 7 — Push to WeChat draft

Call the `wenyan` MCP server's render/publish tools to push the draft.
If this fails (bad credentials, IP not whitelisted), surface the error and stop. Do NOT update `data/words.json`.

## Step 8 — Record success

Update `data/words.json`:
- Set the word's `status` to `"published"`
- Set `published_at` to today's ISO date (YYYY-MM-DD)
- Set `article_path` to `"articles/YYYY-MM-DD-<word>.md"`

Use atomic write (read → modify → write temp → rename) — call `scripts/lib/words.mjs` helpers or replicate the pattern.

Commit:
```bash
git add articles/ data/words.json
git commit -m "article: <word> — YYYY-MM-DD"
```
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/
git commit -m "feat: daily-article Claude Code skill — step-by-step article flow"
```

---

## Task 9: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Replace the content of `README.md` with:

```markdown
# Word of the Day (每日一词)

Daily English-word articles for a Chinese WeChat subscription account (微信公众号).

## How it works

**Daily article** — run the `daily-article` skill in Claude Code each day. Claude picks the next word, searches Bilibili for video clips, renders a hero card image, writes the article, and pushes it to the WeChat draft box for manual review.

**Word replenishment** — automatic. GitHub Actions runs daily and calls `scripts/generate-words.mjs` whenever the word queue drops below 30 available words.

## Prerequisites

- Node.js ≥ 20.12
- Playwright Chromium: `npx playwright install chromium`
- `.env` file (gitignored) with `WECHAT_APP_ID`, `WECHAT_APP_SECRET`
- (For manual replenishment) `DEEPSEEK_API_KEY` in env

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in your credentials
```

## Scripts

| Command | Purpose |
|---------|---------|
| `node scripts/generate-words.mjs` | Replenish word queue via DeepSeek |
| `node scripts/render-card.mjs confusion ...` | Render confusion-pair hero card |
| `node scripts/render-card.mjs phrase ...` | Render top-phrase hero card |
| `node scripts/download-thumbnail.mjs <url> <dest>` | Download a Bilibili thumbnail |
| `npm test` | Run unit tests |

## Architecture

See [`docs/superpowers/specs/2026-07-24-word-of-the-day-design.md`](docs/superpowers/specs/2026-07-24-word-of-the-day-design.md) for the full design.
```

- [ ] **Step 2: Create `.env.example`**

Create `.env.example`:
```
WECHAT_APP_ID=your_wechat_app_id_here
WECHAT_APP_SECRET=your_wechat_app_secret_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: README with setup instructions and script reference"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in |
|---|---|
| Daily flow: pick word (FIFO, available) | Task 2 (`selectNextWord`) + Task 8 skill Step 1 |
| Daily flow: Bilibili search + clip selection | Task 8 skill Step 2 |
| Daily flow: download thumbnails | Task 3 (`download-thumbnail.mjs`) + Task 8 skill Step 3 |
| Daily flow: write content with hero hook selection | Task 8 skill Step 4 |
| Daily flow: render hero card (confusion + phrase variants) | Tasks 4+5 + Task 8 skill Step 5 |
| Daily flow: assemble Markdown (frontmatter, structure) | Task 8 skill Step 6 |
| Daily flow: push to WeChat draft via wenyan-mcp | Task 8 skill Step 7 |
| Daily flow: record success, atomic write, commit | Task 2 (`writeWords`) + Task 8 skill Step 8 |
| Word replenishment: DeepSeek API, batch ~1000 | Task 6 |
| Word replenishment: additive+dedup invariants | Task 2 (`mergeWords`) |
| Word replenishment: GitHub Actions CI, threshold 30 | Task 7 |
| Hero card: wide (800×340) + square (600×600) | Task 5 |
| Hero card: typography (Inter + Noto Sans SC) | Task 4 |
| Hero card: color palette (light + dark) | Task 4 (light; dark mode is open item) |
| Error handling: no words → stop | Task 8 skill Step 1 |
| Error handling: Bilibili empty → no clips section | Task 8 skill Step 2 |
| Error handling: thumbnail fail → text link | Task 8 skill Step 3 |
| Error handling: card render fail → stop, no data mutation | Task 8 skill Step 5 |
| Error handling: WeChat push fail → stop, no data mutation | Task 8 skill Step 7 |
| Atomic writes to words.json | Task 2 (`writeWords`) |
| MCP config (`.mcp.json`) | Task 1 |
| Unit tests: merge logic | Task 2 |
| Unit tests: word selection | Task 2 |
| Smoke test: card render (both variants) | Task 5 |

**Open items from spec (deferred, not blocked):**
- Dark mode card CSS (listed as open item in spec — add to `card.css` in a follow-up)
- Wenyan theme choice (default vs. OrangeHeart) — set when running the daily flow
- Cron schedule exact time — set to `02:00 UTC` (10:00 CST); adjust if needed
- Exact accent color (rust vs. muted blue) — currently rust (`#C97A5A`); tune during smoke test
- Colorblind-safe palette validation — validate once design is finalized
