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
