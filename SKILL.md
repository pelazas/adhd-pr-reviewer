---
name: adhd-pr-reviewer
description: Create an ADHD PR review video: a vertical PR video with a frontend demo, brainrot gameplay, word captions, narration, and an optional GitHub PR comment.
disable-model-invocation: false
---

# ADHD PR Reviewer

The pipeline root is `/Users/pelazas/Desktop/adhd-pr-reviewer` unless `ADHD_PR_REVIEWER_ROOT` is set. Run every command from that directory.

Use this skill when asked to make an ADHD PR review, PR video, brainrot review, or demo video for a frontend PR.

## Workflow

1. Read the PR with `gh pr view` and identify visible frontend changes. Prefer an existing preview URL; start a local dev server only when no preview exists.
2. Confirm `gh auth status` and that the target PR can be viewed/commented on before paid TTS or rendering.
3. Read `prompts/demo-plan.md`, create a JSON plan matching `schemas/demo-plan.schema.json`. First beat is the GitHub PR (`startUrl`; private PRs render a local card via `gh pr view`); a later beat `goto`s the preview. Each beat has one exact narration cue and a target (`role` and `name`, `selector`, or `text`). Setup steps (`goto`, `waitForLoad`, `wait`, `scroll`) run before the cursor approaches; inspect steps (`click`, `fill`, `select`, `hover`, `press`) run during the beat. Never generate Playwright code. Clicks and fills require a postcondition. A failure leaves `artifacts/failure.png` and exits non-zero.
4. Read `prompts/narration.md`, write `artifacts/narration.txt`, then run TTS before recording:

   ```bash
   npx tsx scripts/generate-tts.ts artifacts/narration.txt
   npx tsx scripts/record-demo.ts artifacts/demo-plan.json
   npx tsx scripts/render.ts
   ```

   The recorder matches cues to timestamped caption tokens, glides a visible cursor to each target, and writes `public/emphasis.json`. The pipeline loads `ELEVENLABS_API_KEY` from `.env`; never display or commit it. `public/brainrot.mp4` must be a local user-supplied gameplay clip and plays at volume 0.14. The demo is muted; narration stays full volume.
5. If the user asked to post, run:

   ```bash
   npx tsx scripts/post-pr.ts
   ```

   This example posts to `pelazas/portfolio#1`. For another repository or PR, update the two constants in `scripts/post-pr.ts` deliberately before posting. It requires `gh >= 2.99.0` with `--attach`; if unavailable, report the upgrade requirement and retain the local MP4.

## Output rules

- The composition is fixed: 1080×1920, demo at the top, looping gameplay at the bottom, phrase captions over the gameplay at the frame bottom, and a PR chip for the opening GitHub beat.
- The demo plays once at 1× after its recorder offset; its final frame freezes for any remaining narration. A visible cursor, clicks, text selection, and typing are in the recording. Zoom in post follows each beat target. There is no red highlight box.
- Rendered output is `out/adhd-review-1.mp4`, H.264, and the render script rejects output over 10MB.
- Do not push, commit secrets, commit gameplay/video artifacts, or auto-post. Posting is opt-in only.
