import "dotenv/config";
import {execFileSync} from "node:child_process";
import {existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

const output = "out/adhd-review-1.mp4";
const maxBytes = 10 * 1024 * 1024;
const run = (command: string, args: string[]) => execFileSync(command, args, {stdio: "inherit"});
const size = (path: string) => {
  run("ffprobe", ["-v", "error", "-show_entries", "format=size", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  return statSync(path).size;
};

const makeRenderPublicDir = () => {
  // The checked-in public/brainrot.mp4 is deliberately a symlink. Remotion's
  // renderer refuses to serve a *file* symlink, so stage hard links in a
  // temporary public directory. They use no duplicate video storage and
  // staticFile() still resolves exclusively from the render public directory.
  const directory = resolve("artifacts", `remotion-public-${process.pid}-${Date.now()}`);
  for (const relative of ["brainrot.mp4", "demo.mp4", "demo-last.png", "narration.mp3", "captions.json", "emphasis.json", "fonts/Arial-Bold.ttf"]) {
    const destination = join(directory, relative);
    mkdirSync(dirname(destination), {recursive: true});
    linkSync(realpathSync(join("public", relative)), destination);
  }
  return directory;
};

const main = () => {
  for (const file of ["public/brainrot.mp4", "public/demo.mp4", "public/demo-last.png", "public/narration.mp3", "public/captions.json", "public/emphasis.json"]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}. Run the preceding pipeline step first.`);
  }
  mkdirSync("out", {recursive: true});
  const renderPublic = makeRenderPublicDir();
  const inputProps = join(renderPublic, "input-props.json");
  writeFileSync(inputProps, JSON.stringify({captions: JSON.parse(readFileSync("public/captions.json", "utf8")), emphasis: JSON.parse(readFileSync("public/emphasis.json", "utf8"))}));
  // Remotion gets caption props from a local JSON file; all media remains in public/ for staticFile().
  run("npx", ["remotion", "render", "src/index.ts", "ADHDReview", output, `--props=${inputProps}`, `--public-dir=${renderPublic}`, "--codec=h264", "--crf=28"]);
  let bytes = size(output);
  if (bytes > maxBytes) {
    const smaller = "out/adhd-review-1.small.mp4";
    run("ffmpeg", ["-y", "-i", output, "-c:v", "libx264", "-crf", "31", "-maxrate", "1200k", "-bufsize", "2400k", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", smaller]);
    renameSync(smaller, output);
    bytes = size(output);
  }
  if (bytes > maxBytes) throw new Error(`Final MP4 is ${(bytes / 1024 / 1024).toFixed(2)}MB, still over GitHub's 10MB attachment limit.`);
  console.log(`Created ${output} (${(bytes / 1024 / 1024).toFixed(2)}MB)`);
};

main();
