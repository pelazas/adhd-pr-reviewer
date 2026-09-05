import "dotenv/config";
import {execFileSync} from "node:child_process";
import {existsSync, statSync, writeFileSync} from "node:fs";

const minimumGh = [2, 99, 0];
const compareVersions = (actual: number[]) => {
  for (let index = 0; index < minimumGh.length; index++) {
    if (actual[index] > minimumGh[index]) return 1;
    if (actual[index] < minimumGh[index]) return -1;
  }
  return 0;
};

const main = () => {
  const video = "out/adhd-review-1.mp4";
  if (!existsSync(video)) throw new Error(`Missing ${video}; render locally before posting.`);
  const probedBytes = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=size", "-of", "default=noprint_wrappers=1:nokey=1", video], {encoding: "utf8"}).trim());
  if (!Number.isFinite(probedBytes) || probedBytes !== statSync(video).size || probedBytes > 10 * 1024 * 1024) throw new Error("Refusing to post: ffprobe reports a video over 10MB. Re-run scripts/render.ts to re-encode it.");
  execFileSync("gh", ["auth", "status"], {stdio: "inherit"});
  execFileSync("gh", ["pr", "view", "1", "-R", "pelazas/portfolio", "--json", "url,state"], {stdio: "inherit"});
  const version = execFileSync("gh", ["--version"], {encoding: "utf8"}).match(/gh version (\d+)\.(\d+)\.(\d+)/);
  const actual = version ? version.slice(1).map(Number) : [];
  if (actual.length !== 3 || compareVersions(actual) < 0) {
    throw new Error("GitHub CLI 2.99.0+ with --attach is required to post video attachments. Upgrade gh; the local MP4 was kept at out/adhd-review-1.mp4.");
  }
  const help = execFileSync("gh", ["pr", "comment", "--help"], {encoding: "utf8"});
  if (!help.includes("--attach")) {
    throw new Error("This gh build does not support `gh pr comment --attach`. Upgrade gh to 2.99.0+; the local MP4 was kept at out/adhd-review-1.mp4.");
  }
  writeFileSync("comment.md", "Review take: Experience, Education, and Contact were already written and sitting unused. This PR mounts them, plus How I build.\n\n![](out/adhd-review-1.mp4)\n");
  const result = execFileSync("gh", ["pr", "comment", "1", "-R", "pelazas/portfolio", "--body-file", "comment.md", "--attach", video], {encoding: "utf8"});
  const url = result.match(/https:\/\/github\.com\/[^\s]+\/issues\/comment\/\d+/)?.[0] ?? result.trim();
  console.log(`Posted PR comment: ${url}`);
};

main();
