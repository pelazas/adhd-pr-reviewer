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
3. Read `prompts/demo-plan.md`, create a JSON plan matching `schemas/demo-plan.schema.json`, then run:

   ```bash
   npx tsx scripts/record-demo.ts artifacts/demo-plan.json
   ```

   The plan is declarative: never generate Playwright code. Keep a first-run demo around 35–45 seconds. Clicks and fills require a postcondition. A failure leaves `artifacts/failure.png` and exits non-zero.
4. Read `prompts/narration.md`, write `artifacts/narration.txt`, then run:

   ```bash
   npx tsx scripts/generate-tts.ts artifacts/narration.txt
   npx tsx scripts/render.ts
   ```

   The pipeline loads `ELEVENLABS_API_KEY` from `.env`; never display or commit it. `public/brainrot.mp4` must be a local user-supplied gameplay clip. It is muted, like the demo; narration is the only audio.
5. If the user asked to post, run:

   ```bash
   npx tsx scripts/post-pr.ts
   ```

   This example posts to `pelazas/portfolio#1`. For another repository or PR, update the two constants in `scripts/post-pr.ts` deliberately before posting. It requires `gh >= 2.99.0` with `--attach`; if unavailable, report the upgrade requirement and retain the local MP4.

## Output rules

- The composition is fixed: 1080×1920, demo at the top, muted looping gameplay at the bottom, captions near the split, and a two-second PR chip.
- The demo plays once at 1×; its final frame freezes for any remaining narration.
- Rendered output is `out/adhd-review-1.mp4`, H.264, and the render script rejects output over 10MB.
- Do not push, commit secrets, or commit gameplay/video artifacts.
