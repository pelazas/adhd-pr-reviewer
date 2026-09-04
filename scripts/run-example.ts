import {execFileSync} from "node:child_process";

const run = (args: string[]) => execFileSync("npx", ["tsx", ...args], {stdio: "inherit"});

// Verify access before any paid TTS call or render work.
execFileSync("gh", ["auth", "status"], {stdio: "inherit"});
execFileSync("gh", ["pr", "view", "1", "-R", "pelazas/portfolio", "--json", "number,url,state"], {stdio: "inherit"});
run(["scripts/record-demo.ts", "artifacts/examples/portfolio-pr-1.json"]);
run(["scripts/generate-tts.ts", "artifacts/examples/portfolio-pr-1-narration.txt"]);
run(["scripts/render.ts"]);
run(["scripts/post-pr.ts"]);
