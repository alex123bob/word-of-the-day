# Word of the Day — Design

Date: 2026-07-24

## Goal

Publish one article per day to a WeChat public subscription account (微信公众号). Each
article teaches one English word to a Chinese-speaking audience. The article is
rendered from Markdown by [wenyan-mcp](https://github.com/caol64/wenyan-mcp) and pushed
to the WeChat **draft box** for manual review and publishing.

## Design principle — glanceable first

The typical reader checks this on their daily commute and spends only a few seconds per
article. The design must reward a glance:

- Every article opens with a **beautiful hero card** (a rendered image) that conveys the
  single most useful point about the word — usually a confusion pair (易混词) or the top
  phrase — so it lands in seconds and also serves as the eye-catching feed cover.
- **Video comes second, right after the card** — real Bilibili clips are the richest visual
  aid, so they get prime real estate immediately below the hero card rather than being
  buried at the bottom.
- Below that, fuller word detail is available for readers who want depth, but the card +
  video must be worth the glance on their own.

Content angles are inspired by [lijialab.com](https://lijialab.com), a dictionary that goes
beyond definitions with **etymology, cultural notes, word family, and real video examples**.
We borrow those "sticky" layers where they are short and memorable — not as exhaustive
reference text.

## Non-goals

- Fully automated end-to-end publishing. wenyan-mcp only writes to the draft box; a human
  reviews and hits publish in the WeChat app. This is intentional — posts are public and
  irreversible.
- Embedding playable Bilibili videos in the WeChat article. WeChat drafts do not allow
  arbitrary embeds, so each clip appears as a large clickable thumbnail (a real video frame)
  that links out to Bilibili — not an in-place player.

## Architecture

Two MCP servers registered for **Claude Code**, which drives the daily flow directly —
picking the word, deciding which Bilibili clips are genuinely good, writing the content,
and calling the MCP tools. A small set of deterministic Node helper scripts handle the
mechanical, non-agentic steps (thumbnail download, card rendering, word-list bookkeeping).
A separate, fully standalone script + GitHub Action replenishes the word list using the
DeepSeek API — that piece runs unattended in CI, so it cannot rely on an interactive agent.

**Why the split:** the daily article needs judgment (which clip actually shows the word in
use, what's the sharpest hook) — that's Claude Code's job, run interactively each day. Word
replenishment needs no judgment beyond "generate plausible words" and must run on a schedule
with nobody watching — that's a plain API-call script. Using DeepSeek there (rather than
Claude) keeps CI decoupled from any Claude Code/Anthropic credential; the daily flow, by
contrast, needs no API key at all since Claude Code supplies its own model access.

### MCP servers

1. **wenyan-mcp** (`@wenyan-md/mcp`) — renders Markdown → pushes to WeChat draft box.
   - Requires env `WECHAT_APP_ID`, `WECHAT_APP_SECRET`.
   - The machine's public IP must be on the WeChat backend IP whitelist.
   - Expects Markdown with frontmatter: `title` (required), optional `cover`, `author`,
     `source_url`, and theme selection. If `cover` is omitted, the first image in the body
     is used as the cover.
2. **bilibili-mcp-js** (`github.com/34892002/bilibili-mcp-js`, npm `bilibili-mcp-js`, MIT) —
   keyword video search.
   - Exposes `searchBilibili` (keyword → native video objects: `title`, `bvid`, `arcurl`,
     `description`, `play` view count, `duration`, `author`/`owner`, `pic`, `pubdate`).
   - Works **anonymously**: no login/SESSDATA, no WBI signing. It auto-fetches an anonymous
     `buvid3` cookie (by hitting the homepage) to clear Bilibili's `-412` anti-scrape.
   - Run via `npx bilibili-mcp-js` (Node ≥ 20.12).

Both are registered in the repo's MCP config (`.mcp.json`).

### Data model — `data/words.json`

Single JSON file, the source of truth for the word queue. Array of entries:

```json
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
```

Field semantics:

| Field | Values / notes |
|-------|----------------|
| `word` | The English word. Unique key (case-insensitive). |
| `status` | `available` → `published`. Only ever moves forward. |
| `difficulty` | `beginner` \| `intermediate` \| `advanced` |
| `part_of_speech` | Primary POS, e.g. `adj.`, `n.`, `v.` |
| `source` | `learner-list` \| `hot-topic` |
| `theme` | Optional free-text tag, else `null` |
| `added_at` | ISO date the word entered the list |
| `published_at` | ISO date it was published, else `null` |
| `article_path` | Repo-relative path to the generated `.md`, else `null` |

**Invariants:**

- **Additive, never destructive.** Regeneration only appends. Existing entries — especially
  `available` ones not yet published — are never overwritten, reordered, or deleted.
- **Dedup by `word`, case-insensitive.** A generated candidate already present is skipped.
- Status transitions are one-way: `available → published`.

### Daily flow — driven by Claude Code, not a script

You trigger a Claude Code session each day (e.g. via a slash command / skill in this repo).
Claude Code performs the judgment-heavy steps itself, calling the two MCP servers as tools,
and delegates only the mechanical bits to helper scripts:

1. **Pick word** — read `data/words.json`, pick the oldest `available` entry (FIFO by
   `added_at`). Tell the user and stop cleanly if none are available (point at the
   replenishment workflow).
2. **Find clips** — call the `bilibili-search` MCP's `searchBilibili` tool for the word.
   Use judgment to prefer real-usage content (movie / cartoon / TV clips) over unrelated
   results, ranking by relevance + view count, and pick the best 1–3. If nothing suitable
   turns up, proceed without the clips section and say so.
3. **Download thumbnails** — run `scripts/download-thumbnail.mjs <url> <dest>` for each
   selected clip's `pic` thumbnail into `articles/assets/`. WeChat blocks external image
   hotlinks, so thumbnails must be local files before wenyan-mcp uploads them. A failed
   download degrades that clip to a plain text link.
4. **Write content** — write the word's structured content directly (see "Article content"
   below), including the **hero hook** (confusion-pair vs. top-phrase).
5. **Render hero card** — run `scripts/render-card.mjs` with the hero hook to produce a PNG
   (see "Hero card rendering"). This PNG is both the in-article hero image and the article
   `cover`.
6. **Assemble Markdown** — write the article `.md` (frontmatter + hero card + video block +
   body).
7. **Draft to WeChat** — call the `wenyan-mcp` render/publish tools to push the draft.
8. **Record** — on success: save the `.md` to `articles/YYYY-MM-DD-<word>.md` and assets
   under `articles/assets/`, update the word's `status=published`, `published_at`,
   `article_path` in `data/words.json`, and commit.

If any step fails, `data/words.json` is left unchanged (word stays `available`) so the next
run retries the same word. No LLM API key is needed for this flow — Claude Code supplies
its own model access.

### Word-list replenishment — standalone script (CI)

`scripts/generate-words.mjs` is a plain unattended script (no Claude Code involved), because
it must run on a schedule in GitHub Actions with nobody watching.

1. Calls the **DeepSeek API** directly (OpenAI-compatible endpoint, `DEEPSEEK_API_KEY`) to
   produce a batch of ~1000 learner-friendly words — a blend of common English-learner
   vocabulary and currently-discussed / hot terms. Requests structured JSON back
   (`word`, `difficulty`, `part_of_speech`, `source`, optional `theme`).
2. Merges into `data/words.json` following the additive + dedup invariants.
3. Prints a summary: `N new, M skipped as duplicates, K total available`.

Batch size (~1000) and the generation prompt live in the script as named constants so they
are easy to tune.

### Hero card rendering

The hero card is a rendered **PNG image** — themed CSS in WeChat cannot do custom layout, so
a real image is the only way to get a beautiful, glanceable card, and it doubles as the feed
cover that catches the eye.

**Visual style: Clean minimalist editorial.** Not cartoon/mascot (reads childish), not
hand-painted (hard to scale programmatically). Proven by Readwise, iA Writer, Bear,
NYT word cards — premium, glanceable, professional.

- `scripts/render-card.mjs` takes the hero hook (word + the single key point) and renders an
  HTML/CSS template to PNG headlessly (Playwright — Chromium already reliable for this;
  chosen over satori so the template is plain HTML/CSS).
- **Typography:** 
  - CJK: Noto Sans SC (open source, clean, professional)
  - Latin: Inter (designed for screens, pairs beautifully with Noto)
- **Color palette (light mode):**
  - Background: `#FAF7F2` (warm off-white, paper-like)
  - Primary text (word): `#1A1A1A` (high contrast)
  - Secondary text (hook): `#666666` (readable, recessive)
  - Accent (optional): one muted color, e.g. `#C97A5A` (rust) or `#5B7C99` (muted blue)
- **Dark mode:**
  - Background: `#1F1F1F` or `#2A2A2A`
  - Primary text: `#F5F5F5`
  - Secondary text: `#AAAAAA`
- **Layout:** Generous vertical padding (top/bottom ~15%). Focal word centered, large.
  Hero hook below in secondary text. Minimal decoration.
- **Dimensions:** 2.35:1 (WeChat cover standard, ~800×340px for retina clarity) plus 1:1
  square variant (~600×600px) for social repost.
- **Card variants:** Two layout templates — confusion-pair layout vs. phrase layout — so
  the card's structure matches the auto-picked hook.

**Rendering settings:** Device scale factor 2.0 for retina, fixed viewport sizing for
consistency, font embedding (via @font-face) to avoid FOUT. Palette will be validated
against colorblind-safe separation before launch.

### Hero hook — the single most important point (auto-picked)

For each word the content generator selects the ONE most valuable thing to feature on the
card, and returns which variant it chose:

- **Confusion pair (易混词)** — when the word has a notable easily-confused counterpart
  (e.g. affect/effect), the card shows the pair with a crisp "用 X 表示…，用 Y 表示…" contrast.
- **Top phrase / collocation** — when a common phrase is the word's most useful takeaway.

The generator picks whichever fits the specific word best rather than a fixed section.

### Article content (Chinese; target = the day's English word)

Frontmatter: `title` (e.g. `每日一词 | resilient`), `cover` (the rendered card PNG),
`author`, wenyan theme.

Structure — **hero card first, then video, then fuller detail for depth**:

- **Hero card (image)** — the auto-picked hook, at the very top.
- **真实语境（B站视频）** — placed second, right after the card, as the article's main
  visual aid. Each selected clip is a **large clickable thumbnail** (the downloaded `pic`
  frame) linking to the Bilibili video, with the video title, view count, and one line on
  how the word shows up in that clip. Styled to read as a video (play-button treatment). Not
  an embedded player.
- **单词** — the word, US/UK phonetics, one-line core meaning.
- **基本释义** — definitions grouped by part of speech, each with a short example
  (English + Chinese gloss).
- **常见搭配 / 短语** — common collocations and phrases.
- **常见用法** — concise usage notes: register, typical patterns, nuances.
- **易混词辨析** — comparison against easily-confused words, with "用 X 表示…，用 Y 表示…"
  guidance. (Expands on the card when the hook was a confusion pair.)
- **一点趣味** — one short, sticky angle borrowed from lijialab.com: etymology, a cultural
  note, or the word family — whichever is most memorable for this word. Kept to a couple of
  lines, not reference-length.

Every section stays tight; the article must read as a quick skim, with the card + video
carrying the core value on their own.

### GitHub CI — word replenishment

`.github/workflows/replenish-words.yml`:

- Scheduled (daily) + manual `workflow_dispatch`.
- Counts `available` words in `data/words.json`. If below the threshold (**30**), runs
  `scripts/generate-words.mjs` and commits the updated list back to the repo.
- Requires repo secret `DEEPSEEK_API_KEY`.
- **Only replenishment runs in CI.** The daily article flow runs locally through Claude
  Code (triggered by you each day) because it needs judgment calls (clip relevance, hook
  selection) plus WeChat's IP whitelist and human review of the draft — none of which fit
  an unattended script.

## Configuration & secrets

- Local `.env` (gitignored): `WECHAT_APP_ID`, `WECHAT_APP_SECRET` (used by `wenyan-mcp`,
  driven by Claude Code). `DEEPSEEK_API_KEY` is only needed locally if you want to run
  `generate-words.mjs` by hand; otherwise it lives solely as a CI secret.
- CI secret: `DEEPSEEK_API_KEY`.
- `.mcp.json`: registers `wenyan-mcp` and `bilibili-mcp-js` for Claude Code.
- Dependencies: `playwright` (Chromium) for card rendering (local only, invoked by Claude
  Code as part of the daily flow — not a CI dependency).

## Error handling

- **No available words** → Claude Code tells the user and stops; no write to
  `data/words.json`. Points at the replenishment workflow (or running
  `generate-words.mjs` manually).
- **Bilibili search empty / rate-limited (`-412`)** → article generated without the clips
  section; the omission is called out to the user. `bilibili-mcp-js` handles cookie
  fetching; avoid rapid bursts.
- **Thumbnail download fails** → that clip degrades to a plain text link (title + URL); the
  rest of the article is unaffected and the degradation is called out.
- **Card render fails** → surface the error and stop before drafting; do not mutate
  `data/words.json` (the article must not go out without its hero card).
- **WeChat draft push fails** (bad credentials, IP not whitelisted) → surface the error, do
  not mutate `data/words.json`.
- **Word-list writes are atomic** — write to a temp file then rename, so a crash cannot
  corrupt `data/words.json`.

## Testing

- Unit-test the merge logic in `generate-words` (additive, dedup, no overwrite of
  unpublished words) with a small in-memory fixture.
- Unit-test the word-selection helper (FIFO, skips published, empty-list case) used by the
  daily flow.
- Card render smoke test: render both card variants from fixed sample content and eyeball
  the PNGs.
- Manual smoke test: run the daily flow end-to-end through Claude Code against the real MCP
  servers and verify a draft (with hero card as cover) appears in the WeChat backend.

## Open items to confirm at implementation time

- Which wenyan theme to use for the daily article (default vs. OrangeHeart).
- Exact cron schedule time for the `replenish-words.yml` CI workflow.
- Fine-tune card padding/spacing and exact accent color choice (rust vs. muted blue, or
  context-based selection).
