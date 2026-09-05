# Demo-plan prompt

Write `artifacts/demo-plan.json`, never Playwright code. Follow `schemas/demo-plan.schema.json`.

- Provide 1–8 `beats`, in narration order. Every beat needs a `cue` that appears exactly once in the generated captions and a `target`: `{role, name}`, `{selector}`, or `{text}`. The target is what must already be visible when that cue starts.
- Add optional `steps` only inside a beat. Use only `goto`, `waitForLoad`, `wait`, `scroll`, `click`, `fill`, `hover`, and `press`; keep all beats to 16 steps total. Use the supplied preview URL or localhost only.
- A `click` or `fill` must include a postcondition (`selector`, `text`, or `urlIncludes`) that visibly confirms it worked.
- Do not schedule scrolling at a cue. The recorder starts each transition 1600ms before the next cue, scrolls the target into view, measures it, and holds it. Use `wide: true` for an overview: it keeps the target as the visible anchor but draws no highlight; its default scale is 1.05. Other beats default to scale 1.35.
- Generate TTS before recording so `public/captions.json` exists. Do not add assertions, arbitrary JavaScript, file access, or actions outside the schema.
