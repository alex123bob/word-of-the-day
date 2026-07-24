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
