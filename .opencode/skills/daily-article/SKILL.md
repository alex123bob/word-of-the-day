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
