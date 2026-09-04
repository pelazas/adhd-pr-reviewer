# ADHD PR Reviewer

Turns a frontend PR into a 1080×1920 review video: recorded demo on top, muted gameplay below, timestamped captions, and ElevenLabs narration. The example targets `pelazas/portfolio#1`.

## Install

1. Install Node 20+, `ffmpeg`, and optionally the GitHub CLI (`gh`) for posting.
2. Clone this repository, then install dependencies:

   ```bash
   npm install
   npx playwright install chromium
   ```
3. Copy `.env.example` to `.env` and add `ELEVENLABS_API_KEY`. Never commit `.env`.
4. Supply a gameplay clip. Remotion can only read public assets, so symlink or copy it into `public/brainrot.mp4`:

   ```bash
   ln -s /absolute/path/to/gameplay.mp4 public/brainrot.mp4
   ```
5. Install the skill for your preferred agent by copying the complete skill folder (the prompts and schema are referenced relatively):

   ```bash
   mkdir -p ~/.cursor/skills/adhd-pr-reviewer ~/.claude/skills/adhd-pr-reviewer
   cp SKILL.md ~/.cursor/skills/adhd-pr-reviewer/
   cp SKILL.md ~/.claude/skills/adhd-pr-reviewer/
   cp -R prompts schemas ~/.cursor/skills/adhd-pr-reviewer/
   cp -R prompts schemas ~/.claude/skills/adhd-pr-reviewer/
   ```

## Run the included example

```bash
npx tsx scripts/run-example.ts
```

It validates GitHub access first, records the demo, requests timestamped TTS, renders `out/adhd-review-1.mp4`, checks it is under 10MB, and posts a PR comment if `gh >= 2.99.0` supports `--attach`.

Or run the stages separately:

```bash
npx tsx scripts/record-demo.ts artifacts/examples/portfolio-pr-1.json
npx tsx scripts/generate-tts.ts artifacts/examples/portfolio-pr-1-narration.txt
npx tsx scripts/render.ts
npx tsx scripts/post-pr.ts
```

The large videos, narration, captions, screenshots, `.env`, and output directory are intentionally gitignored. For a new PR, make a valid JSON plan from `prompts/demo-plan.md`, write a specific narration from `prompts/narration.md`, then adapt the PR destination in `scripts/post-pr.ts` before posting.
