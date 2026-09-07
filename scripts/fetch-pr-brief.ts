import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";

export type PrFile = {path: string; additions: number; deletions: number};
export type PrJson = {
  number: number;
  title?: string;
  body?: string | null;
  url?: string;
  files?: Array<{path?: string; filename?: string; additions?: number; deletions?: number}>;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

const NOISE_RX =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$|\.(min\.js|min\.css|map|snap)$|(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//;
const UI_EXT = /\.(tsx|jsx|vue|svelte|css|scss|sass|html|astro)$/;
const UI_DIR_TS = /(^|\/)(app|src|components|pages|ui)\/.*\.(ts|js)$/;
const TEST_RX = /\.(test|spec|stories)\./;
const MAX_BODY = 2000;
const MAX_FILES = 20;
const MAX_HUNK_FILES = 4;
const MAX_HUNK_LINES = 12;
const FIELDS = "number,title,body,url,files,additions,deletions,changedFiles";

export const isNoise = (path: string) => NOISE_RX.test(path);
export const isFrontend = (path: string) =>
  Boolean(path) && !isNoise(path) && !TEST_RX.test(path) && (UI_EXT.test(path) || UI_DIR_TS.test(path));

const churn = (file: PrFile) => file.additions + file.deletions;

export const parseDiff = (raw: string): Map<string, string[][]> => {
  const byPath = new Map<string, string[][]>();
  let curPath: string | null = null;
  let curHunk: string[] | null = null;
  const ensure = (path: string) => {
    if (!byPath.has(path)) byPath.set(path, []);
    return byPath.get(path)!;
  };
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      curPath = match ? match[2] : null;
      curHunk = null;
      if (curPath) ensure(curPath);
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "").trim();
      if (path && path !== "/dev/null") {
        curPath = path;
        ensure(curPath);
      }
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      if (!curPath) continue;
      curHunk = [line];
      ensure(curPath).push(curHunk);
      continue;
    }
    if (curHunk && curPath && !line.startsWith("\\")) curHunk.push(line);
  }
  return byPath;
};

export const renderHunk = (hunk: string[], maxLines = MAX_HUNK_LINES): string => {
  const changed: string[] = [];
  for (const line of hunk.slice(1)) {
    if (line.startsWith("+") || line.startsWith("-")) changed.push(line);
    else if (changed.length && changed[changed.length - 1] !== "  ⋯") changed.push("  ⋯");
  }
  while (changed.length && changed[changed.length - 1] === "  ⋯") changed.pop();
  const kept = changed.slice(0, maxLines);
  const extra = changed.length > maxLines ? `\n  …(+${changed.length - maxLines} more changed lines)` : "";
  return [hunk[0], ...kept].join("\n") + extra;
};

const cleanBody = (raw: string) => {
  let text = raw;
  for (let prev = null as string | null; prev !== text; ) {
    prev = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_BODY) text = `${text.slice(0, MAX_BODY).replace(/\s+\S*$/, "")}\n…(truncated)`;
  return text;
};

const oneSentence = (title: string, body: string) => {
  const first = body.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
  const sentence = (first || title).replace(/\s+/g, " ");
  return sentence.length > 150 ? `${sentence.slice(0, 147).replace(/\s+\S*$/, "")}…` : sentence;
};

const toFiles = (pr: PrJson): PrFile[] =>
  (pr.files ?? [])
    .map((file) => ({
      path: file.path || file.filename || "",
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }))
    .filter((file) => file.path);

const rank = (files: PrFile[], frontend: boolean) =>
  files
    .filter((file) => !isNoise(file.path) && (frontend ? isFrontend(file.path) : true))
    .sort((a, b) => churn(b) - churn(a));

export const buildBrief = (pr: PrJson, diff: string): string => {
  const title = (pr.title || `Pull request #${pr.number}`).trim();
  const url = pr.url || "";
  const body = cleanBody(pr.body || "");
  const files = toFiles(pr);
  const frontend = rank(files, true);
  const listed = (frontend.length ? frontend : rank(files, false)).slice(0, MAX_FILES);
  const byPath = parseDiff(diff);
  const hunkFiles = listed.filter((file) => (byPath.get(file.path) ?? []).length).slice(0, MAX_HUNK_FILES);

  const lines = [
    `# ${title}`,
    url,
    `one sentence: ${oneSentence(title, body)}`,
    "",
    "## Frontend files",
  ];
  if (!frontend.length) lines.push("No frontend-looking files; listing source anyway.");
  if (listed.length) {
    for (const file of listed) lines.push(`- ${file.path}  (+${file.additions} / -${file.deletions})`);
  } else {
    lines.push("No source files after filtering.");
  }
  lines.push("");
  if (hunkFiles.length) {
    lines.push("## Hunks", "");
    for (const file of hunkFiles) {
      lines.push(`### ${file.path}`);
      lines.push((byPath.get(file.path) ?? []).map((hunk) => renderHunk(hunk)).join("\n"));
      lines.push("");
    }
  }
  lines.push("## PR body", body || "(no description provided)", "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
};

export const parsePrRef = (ref: string): string[] => {
  const fromUrl = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(ref);
  if (fromUrl) return [ref];
  const short = /^([^/]+)\/([^#]+)#(\d+)$/.exec(ref);
  if (short) return [short[3], "-R", `${short[1]}/${short[2]}`];
  throw new Error("Usage: tsx scripts/fetch-pr-brief.ts <url | owner/repo#N>");
};

const gh = (args: string[]) => {
  try {
    return execFileSync("gh", args, {encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]});
  } catch (error) {
    const stderr = String((error as {stderr?: Buffer | string}).stderr || (error as Error).message || "").trim();
    throw new Error(stderr || `gh ${args[0]} failed`);
  }
};

const main = () => {
  const ref = process.argv[2];
  if (!ref) throw new Error("Usage: tsx scripts/fetch-pr-brief.ts <url | owner/repo#N>");
  const prArgs = parsePrRef(ref);
  gh(["auth", "status"]);
  const view = gh(["pr", "view", ...prArgs, "--json", FIELDS]);
  const diff = gh(["pr", "diff", ...prArgs]);
  let pr: PrJson;
  try {
    pr = JSON.parse(view) as PrJson;
  } catch {
    throw new Error("gh pr view returned unparseable JSON");
  }
  mkdirSync("artifacts", {recursive: true});
  writeFileSync("artifacts/pr-brief.txt", buildBrief(pr, diff));
  console.log("Wrote artifacts/pr-brief.txt");
};

if (process.argv[1]?.endsWith("fetch-pr-brief.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
