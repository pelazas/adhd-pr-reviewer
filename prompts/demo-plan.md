# Demo-plan prompt

Write `artifacts/demo-plan.json`, never Playwright code. Follow `schemas/demo-plan.schema.json`.

- Use only `goto`, `waitForLoad`, `wait`, `scroll`, `click`, `fill`, `hover`, and `press`.
- Keep to 12 steps. Use the supplied preview URL or localhost only.
- A `click` or `fill` must include a postcondition (`selector`, `text`, or `urlIncludes`) that visibly confirms it worked.
- For a first pass, make 35–45 seconds of intentional viewing: load, pause, then slow scroll through the requested sections. `scroll.y` is an absolute page position and `durationMs` makes it slow.
- Do not add assertions, arbitrary JavaScript, file access, or actions outside the schema.
