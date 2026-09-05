# Demo-plan prompt

Write `artifacts/demo-plan.json`, never Playwright code. Follow `schemas/demo-plan.schema.json`.

- Provide 1–8 `beats`, in narration order. Every beat needs a `cue` that appears exactly once in the generated captions and a `target`: `{role, name}`, `{selector}`, or `{text}`. The target is the framed element after the recorder glides the cursor there.
- Open on the GitHub pull request (`startUrl`). Later beats `goto` the preview or live site. Hosts are allowed only if they already appear as `startUrl` or a `goto` URL in this plan (plus localhost).
- Add optional `steps` inside a beat. Use only `goto`, `waitForLoad`, `wait`, `scroll`, `click`, `fill`, `hover`, `press`, and `select`. At most 32 steps in the whole plan, 16 per beat.
- `goto`, `waitForLoad`, `wait`, and `scroll` run before the cursor approaches the target. `click`, `fill`, `select`, `hover`, and `press` run during the beat, after the target is in view. Use those inspect steps to verify the change (select text, type into a form). Do not hop between headings with no interaction.
- A `click` or `fill` must include a postcondition (`selector`, `text`, or `urlIncludes`) that visibly confirms it worked. `fill` types character by character. Do not submit a form that would send mail.
- The recorder approaches each target with a smooth scroll and a visible cursor as soon as the previous inspect finishes, then holds until the cue. Use `wide: true` for an overview (default scale 1.05). Other beats default to scale 1.15. Zoom is applied in post; do not expect a red box.
- Generate TTS before recording so `public/captions.json` exists. Do not add assertions, arbitrary JavaScript, file access, or actions outside the schema.
