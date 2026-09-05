import "dotenv/config";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Caption} from "@remotion/captions";
import {chromium, type Locator, type Page} from "playwright";
import {z} from "zod";

const actionTimeout = 15_000;
const transitionMs = 1_600;

const postcondition = z.object({selector: z.string().optional(), text: z.string().optional(), urlIncludes: z.string().optional()}).refine((value) => Object.keys(value).length > 0);
const step = z.discriminatedUnion("action", [
  z.object({action: z.literal("goto"), url: z.string().url()}),
  z.object({action: z.literal("waitForLoad")}),
  z.object({action: z.literal("wait"), ms: z.number().int().min(0).max(14_000)}),
  z.object({action: z.literal("scroll"), y: z.number().nonnegative(), durationMs: z.number().int().min(250).max(14_000).optional()}),
  z.object({action: z.literal("click"), selector: z.string().optional(), text: z.string().optional(), role: z.string().optional(), name: z.string().optional(), postcondition}),
  z.object({action: z.literal("fill"), selector: z.string(), value: z.string(), postcondition}),
  z.object({action: z.literal("hover"), selector: z.string()}),
  z.object({action: z.literal("press"), key: z.string()}),
]);
const target = z.union([
  z.object({role: z.string().min(1), name: z.string().min(1)}).strict(),
  z.object({selector: z.string().min(1)}).strict(),
  z.object({text: z.string().min(1)}).strict(),
]);
const beat = z.object({
  cue: z.string().min(1),
  target,
  scale: z.number().positive().optional(),
  wide: z.boolean().default(false),
  steps: z.array(step).max(16).default([]),
});
const planSchema = z.object({
  startUrl: z.string().url(),
  viewport: z.object({width: z.number().int().positive(), height: z.number().int().positive()}),
  beats: z.array(beat).min(1).max(8),
}).superRefine((plan, context) => {
  if (plan.beats.reduce((total, item) => total + item.steps.length, 0) > 16) context.addIssue({code: "custom", message: "beats may contain at most 16 total steps"});
});
const captionsSchema = z.array(z.object({text: z.string(), startMs: z.number(), endMs: z.number()}));

type Plan = z.infer<typeof planSchema>;
type Step = z.infer<typeof step>;
type Target = z.infer<typeof target>;
type EmphasisBeat = {startMs: number; endMs: number; scale: number; x: number; y: number; rect: {x: number; y: number; w: number; h: number} | null};

const allowedUrl = (targetUrl: string, startUrl: string) => {
  const url = new URL(targetUrl);
  const start = new URL(startUrl);
  return ["http:", "https:"].includes(url.protocol) && (url.hostname === start.hostname || url.hostname === "localhost" || url.hostname === "127.0.0.1");
};

const locatorFor = (page: Page, input: Extract<Step, {action: "click"}>) => {
  if (input.selector) return page.locator(input.selector);
  if (input.text) return page.getByText(input.text, {exact: true});
  if (input.role && input.name) return page.getByRole(input.role as never, {name: input.name, exact: true});
  throw new Error("click needs selector, text, or role and name");
};

const targetLocator = (page: Page, input: Target): Locator => {
  if ("selector" in input) return page.locator(input.selector);
  if ("text" in input) return page.getByText(input.text, {exact: true});
  return page.getByRole(input.role as never, {name: input.name, exact: true});
};

const waitForPostcondition = async (page: Page, value: z.infer<typeof postcondition>) => {
  if (value.selector) await page.locator(value.selector).waitFor({state: "visible", timeout: actionTimeout});
  if (value.text) await page.getByText(value.text, {exact: false}).waitFor({state: "visible", timeout: actionTimeout});
  if (value.urlIncludes) await page.waitForURL(`**${value.urlIncludes}**`, {timeout: actionTimeout});
};

const slowScroll = async (page: Page, y: number, durationMs = 4_500) => {
  const start = await page.evaluate("window.scrollY") as number;
  for (let index = 1; index <= 45; index++) {
    const progress = index / 45;
    await page.evaluate(`window.scrollTo(0, ${start + (y - start) * (1 - Math.pow(1 - progress, 3))})`);
    await page.waitForTimeout(durationMs / 45);
  }
};

const runStep = async (page: Page, input: Step, startUrl: string) => {
  switch (input.action) {
    case "goto":
      if (!allowedUrl(input.url, startUrl)) throw new Error(`Disallowed URL: ${input.url}`);
      await page.goto(input.url, {waitUntil: "networkidle", timeout: actionTimeout}); break;
    case "waitForLoad": await page.waitForLoadState("networkidle", {timeout: actionTimeout}); break;
    case "wait": await page.waitForTimeout(input.ms); break;
    case "scroll": await slowScroll(page, input.y, input.durationMs); break;
    case "click": await locatorFor(page, input).click({timeout: actionTimeout}); await waitForPostcondition(page, input.postcondition); break;
    case "fill": await page.locator(input.selector).fill(input.value, {timeout: actionTimeout}); await waitForPostcondition(page, input.postcondition); break;
    case "hover": await page.locator(input.selector).hover({timeout: actionTimeout}); break;
    case "press": await page.keyboard.press(input.key); break;
  }
};

const normalizeTokens = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

const matchCue = (cue: string, captions: Caption[]) => {
  const cueTokens = normalizeTokens(cue);
  const tokens = captions.flatMap((caption) => normalizeTokens(caption.text).map((token) => ({token, startMs: caption.startMs, endMs: caption.endMs})));
  if (!cueTokens.length) throw new Error(`Cue has no matchable tokens: ${cue}`);
  const matches: number[] = [];
  for (let index = 0; index <= tokens.length - cueTokens.length; index++) {
    if (cueTokens.every((token, offset) => tokens[index + offset].token === token)) matches.push(index);
  }
  if (matches.length !== 1) throw new Error(`Cue "${cue}" matched ${matches.length} caption ranges; expected exactly 1`);
  const first = tokens[matches[0]];
  const last = tokens[matches[0] + cueTokens.length - 1];
  return {startMs: first.startMs, endMs: last.endMs};
};

const narrationDurationMs = (captions: Caption[]) => {
  const captionEnd = Math.max(...captions.map((caption) => caption.endMs));
  const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "public/narration.mp3"], {encoding: "utf8"}).trim();
  const audioEnd = Number(output) * 1000;
  return Math.max(captionEnd, Number.isFinite(audioEnd) ? audioEnd : 0);
};

const waitUntil = async (page: Page, targetNs: bigint) => {
  const delayMs = Number(targetNs - process.hrtime.bigint()) / 1e6;
  if (delayMs > 0) await page.waitForTimeout(delayMs);
};

const main = async () => {
  const planPath = process.argv[2];
  if (!planPath) throw new Error("Usage: tsx scripts/record-demo.ts <demo-plan.json>");
  if (!existsSync("public/captions.json")) throw new Error("Missing public/captions.json. Run generate-tts.ts before recording.");
  if (!existsSync("public/narration.mp3")) throw new Error("Missing public/narration.mp3. Run generate-tts.ts before recording.");
  const plan = planSchema.parse(JSON.parse(readFileSync(resolve(planPath), "utf8")));
  const captions = captionsSchema.parse(JSON.parse(readFileSync("public/captions.json", "utf8"))) as Caption[];
  if (!captions.length) throw new Error("public/captions.json is empty");
  if (!allowedUrl(plan.startUrl, plan.startUrl)) throw new Error("startUrl must be http(s)");
  const cues = plan.beats.map((item) => matchCue(item.cue, captions));
  for (let index = 1; index < cues.length; index++) {
    if (cues[index].startMs <= cues[index - 1].startMs) throw new Error("Beat cues must occur once and in narration order");
  }
  const narrationEndMs = narrationDurationMs(captions);
  mkdirSync("artifacts/recordings", {recursive: true});
  mkdirSync("public", {recursive: true});
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: plan.viewport, recordVideo: {dir: resolve("artifacts/recordings"), size: plan.viewport}});
  let page: Page | undefined;
  let video: Awaited<ReturnType<Page["video"]>>;
  try {
    const videoStartNs = process.hrtime.bigint();
    page = await context.newPage();
    video = page.video();
    const setBeat = async (item: Plan["beats"][number], cue: {startMs: number; endMs: number}): Promise<EmphasisBeat> => {
      for (const input of item.steps) await runStep(page!, input, plan.startUrl);
      const targetElement = targetLocator(page!, item.target);
      await targetElement.evaluate((element) => (element as HTMLElement).scrollIntoView({block: "center", inline: "nearest", behavior: "instant"}));
      await page!.waitForTimeout(300);
      const box = await targetElement.evaluate((element) => {
        const heading = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const glyphs = range.getClientRects()[0] ?? heading;
        range.detach();
        return {
          cameraX: glyphs.x + glyphs.width / 2,
          cameraY: glyphs.y + glyphs.height / 2,
          x: glyphs.x,
          y: glyphs.y,
          width: Math.max(glyphs.width, Math.min(heading.width * 0.5, 540)),
          height: glyphs.height,
        };
      });
      if (!box || box.width <= 0 || box.height <= 0) throw new Error(`Target for cue "${item.cue}" has no bounding box`);
      if (box.x >= plan.viewport.width || box.y >= plan.viewport.height || box.x + box.width <= 0 || box.y + box.height <= 0) throw new Error(`Target for cue "${item.cue}" does not intersect the viewport`);
      const pad = 20 / plan.viewport.width;
      const padY = 16 / plan.viewport.height;
      const body = 88 / plan.viewport.height;
      const rect = item.wide ? null : {
        x: Math.max(0, box.x / plan.viewport.width - pad),
        y: Math.max(0, box.y / plan.viewport.height - padY),
        w: Math.min(1, box.width / plan.viewport.width + pad * 2),
        h: Math.min(1 - Math.max(0, box.y / plan.viewport.height - padY), box.height / plan.viewport.height + padY + body),
      };
      return {startMs: cue.startMs, endMs: cue.endMs, scale: item.scale ?? (item.wide ? 1.05 : 1.15), x: box.cameraX / plan.viewport.width, y: box.cameraY / plan.viewport.height, rect};
    };

    await page.goto(plan.startUrl, {waitUntil: "domcontentloaded", timeout: actionTimeout});
    await page.waitForLoadState("networkidle", {timeout: actionTimeout});
    const emphasis = [await setBeat(plan.beats[0], cues[0])];
    const originNs = process.hrtime.bigint();
    const demoOffsetMs = Number(originNs - videoStartNs) / 1e6;
    emphasis[0].startMs = 0;
    for (let index = 1; index < plan.beats.length; index++) {
      const cueStartNs = originNs + BigInt(Math.round(cues[index].startMs * 1e6));
      await waitUntil(page, cueStartNs - BigInt(transitionMs * 1e6));
      const focused = await setBeat(plan.beats[index], cues[index]);
      const overrunMs = Number(process.hrtime.bigint() - cueStartNs) / 1e6;
      if (overrunMs > 400) throw new Error(`Transition for cue "${plan.beats[index].cue}" overran its cue by ${Math.round(overrunMs)}ms`);
      emphasis.push(focused);
    }
    for (let index = 0; index < emphasis.length - 1; index++) emphasis[index].endMs = cues[index + 1].startMs;
    emphasis[emphasis.length - 1].endMs = narrationEndMs;
    await waitUntil(page, originNs + BigInt(Math.round(narrationEndMs * 1e6)));
    writeFileSync("public/emphasis.json", `${JSON.stringify({demoOffsetMs, transitionMs, beats: emphasis}, null, 2)}\n`);
  } catch (error) {
    mkdirSync("artifacts", {recursive: true});
    await page?.screenshot({path: "artifacts/failure.png", fullPage: true}).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
  if (!video) throw new Error("Playwright did not create a recording");
  const source = await video.path();
  if (!source || !existsSync(source)) throw new Error("Recorded webm was not found");
  execFileSync("ffmpeg", ["-y", "-i", source, "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-an", "public/demo.mp4"], {stdio: "inherit"});
  execFileSync("ffmpeg", ["-y", "-sseof", "-0.1", "-i", "public/demo.mp4", "-frames:v", "1", "public/demo-last.png"], {stdio: "inherit"});
  console.log("Created public/demo.mp4, public/demo-last.png, and public/emphasis.json");
};

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
