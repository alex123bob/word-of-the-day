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
