import "dotenv/config";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Caption} from "@remotion/captions";
import {chromium, type Locator, type Page} from "playwright";
import {z} from "zod";

const actionTimeout = 15_000;
const approachDurationMs = 1_800;
const approachOverrunMs = 400;
const inspectOverrunMs = 400;

const postcondition = z.object({selector: z.string().optional(), text: z.string().optional(), urlIncludes: z.string().optional()}).refine((value) => Object.keys(value).length > 0);
const point = {
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
};
const step = z.discriminatedUnion("action", [
  z.object({action: z.literal("goto"), url: z.string().url()}),
  z.object({action: z.literal("waitForLoad")}),
  z.object({action: z.literal("wait"), ms: z.number().int().min(0).max(14_000)}),
  z.object({action: z.literal("scroll"), y: z.number().nonnegative(), durationMs: z.number().int().min(250).max(14_000).optional()}),
  z.object({action: z.literal("click"), ...point, postcondition}),
  z.object({action: z.literal("fill"), selector: z.string(), value: z.string(), postcondition}),
  z.object({action: z.literal("hover"), selector: z.string()}),
  z.object({action: z.literal("press"), key: z.string()}),
  z.object({action: z.literal("select"), ...point}),
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
  if (plan.beats.reduce((total, item) => total + item.steps.length, 0) > 32) context.addIssue({code: "custom", message: "beats may contain at most 32 total steps"});
});
const captionsSchema = z.array(z.object({text: z.string(), startMs: z.number(), endMs: z.number()}));

type Plan = z.infer<typeof planSchema>;
type Step = z.infer<typeof step>;
type Target = z.infer<typeof target>;
type EmphasisBeat = {startMs: number; endMs: number; scale: number; x: number; y: number; rect: null; approachStartMs: number};

const isSetup = (action: Step["action"]) => action === "goto" || action === "waitForLoad" || action === "wait" || action === "scroll";

const planHosts = (plan: Plan) => {
  const hosts = new Set<string>([new URL(plan.startUrl).hostname, "localhost", "127.0.0.1"]);
  for (const item of plan.beats) {
    for (const input of item.steps) {
      if (input.action === "goto") hosts.add(new URL(input.url).hostname);
    }
  }
  return hosts;
};

const allowedUrl = (targetUrl: string, hosts: Set<string>) => {
  const url = new URL(targetUrl);
  return ["http:", "https:"].includes(url.protocol) && hosts.has(url.hostname);
};

const assertPageHost = (page: Page, hosts: Set<string>) => {
  if (!allowedUrl(page.url(), hosts)) throw new Error(`Disallowed URL: ${page.url()}`);
};

const installCursor = () => {
  const draw = () => {
    if (document.getElementById("adhd-cursor")) return;
    const el = document.createElement("div");
    el.id = "adhd-cursor";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;z-index:2147483647;width:28px;height:28px;pointer-events:none;left:0;top:0;margin:0;transform:translate(-2px,-1px);";
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="#fff" stroke="#111" stroke-width="1.25" d="M4.2 2.4v17.8l5.1-5.1 2.1 4.9 2.3-.9-2.1-4.9 6.7-1.1z"/></svg>';
    document.documentElement.appendChild(el);
    document.addEventListener("mousemove", (event) => {
      el.style.left = `${event.clientX}px`;
      el.style.top = `${event.clientY}px`;
    }, true);
  };
  draw();
  document.addEventListener("DOMContentLoaded", draw);
};

const pointLocator = (page: Page, input: {selector?: string; text?: string; role?: string; name?: string}): Locator => {
  if (input.selector) return page.locator(input.selector);
  if (input.text) return page.getByText(input.text, {exact: false}).first();
  if (input.role && input.name) return page.getByRole(input.role as never, {name: input.name, exact: true});
  throw new Error("needs selector, text, or role and name");
};

const targetLocator = (page: Page, input: Target): Locator => {
  if ("selector" in input) return page.locator(input.selector);
  if ("text" in input) return page.getByText(input.text, {exact: false}).first();
  return page.getByRole(input.role as never, {name: input.name, exact: true});
};

const waitForPostcondition = async (page: Page, value: z.infer<typeof postcondition>) => {
  if (value.selector) await page.locator(value.selector).waitFor({state: "visible", timeout: actionTimeout});
  if (value.text) await page.getByText(value.text, {exact: false}).waitFor({state: "visible", timeout: actionTimeout});
  if (value.urlIncludes) await page.waitForURL(`**${value.urlIncludes}**`, {timeout: actionTimeout});
};

const dismissConsent = async (page: Page) => {
  const names = [/^accept all$/i, /^accept$/i, /i understand/i, /^got it$/i];
  for (const name of names) {
    const button = page.getByRole("button", {name});
    if (!await button.first().isVisible().catch(() => false)) continue;
    await button.first().click({timeout: 1_500}).catch(() => undefined);
    await page.waitForTimeout(200);
    return;
  }
};

const loadPage = async (page: Page, url: string, hosts: Set<string>) => {
  if (!allowedUrl(url, hosts)) throw new Error(`Disallowed URL: ${url}`);
  await page.goto(url, {waitUntil: "domcontentloaded", timeout: actionTimeout});
  await page.waitForLoadState("load", {timeout: actionTimeout}).catch(() => undefined);
  await dismissConsent(page);
  assertPageHost(page, hosts);
};

const slowScroll = async (page: Page, y: number, durationMs = approachDurationMs) => {
  const start = await page.evaluate("window.scrollY") as number;
  for (let index = 1; index <= 36; index++) {
    const progress = index / 36;
    await page.evaluate(`window.scrollTo(0, ${start + (y - start) * (1 - Math.pow(1 - progress, 3))})`);
    await page.waitForTimeout(durationMs / 36);
  }
};

const glideTo = async (page: Page, locator: Locator) => {
  await locator.waitFor({state: "visible", timeout: actionTimeout});
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) throw new Error("Target has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 28), {steps: 16});
  return box;
};

const approachTarget = async (page: Page, input: Target, viewportHeight: number) => {
  const targetElement = targetLocator(page, input);
  await targetElement.waitFor({state: "visible", timeout: actionTimeout});
  const desired = await targetElement.evaluate((element, paneH) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    return window.scrollY + rect.top + rect.height / 2 - paneH * 0.42;
  }, viewportHeight);
  const current = await page.evaluate("window.scrollY") as number;
  const distance = Math.abs(Math.max(0, desired) - current);
  if (distance > 24) {
    const duration = Math.min(approachDurationMs, Math.max(350, Math.round(distance * 0.9)));
    await slowScroll(page, Math.max(0, desired), duration);
  }
  await glideTo(page, targetElement);
  await page.waitForTimeout(120);
};

const measureBeat = async (page: Page, item: Plan["beats"][number], viewport: Plan["viewport"]): Promise<Omit<EmphasisBeat, "startMs" | "endMs" | "approachStartMs">> => {
  const targetElement = targetLocator(page, item.target);
  const box = await targetElement.evaluate((element) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    return {cameraX: rect.x + rect.width / 2, cameraY: rect.y + rect.height / 2, x: rect.x, y: rect.y, width: rect.width, height: rect.height};
  });
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`Target for cue "${item.cue}" has no bounding box`);
  if (box.x >= viewport.width || box.y >= viewport.height || box.x + box.width <= 0 || box.y + box.height <= 0) throw new Error(`Target for cue "${item.cue}" does not intersect the viewport`);
  return {scale: item.scale ?? (item.wide ? 1.05 : 1.15), x: box.cameraX / viewport.width, y: box.cameraY / viewport.height, rect: null};
};

const runStep = async (page: Page, input: Step, hosts: Set<string>) => {
  switch (input.action) {
    case "goto":
      await loadPage(page, input.url, hosts); break;
    case "waitForLoad":
      await page.waitForLoadState("load", {timeout: actionTimeout}).catch(() => undefined); break;
    case "wait":
      await page.waitForTimeout(input.ms); break;
    case "scroll":
      await slowScroll(page, input.y, input.durationMs ?? approachDurationMs); break;
    case "click": {
      const locator = pointLocator(page, input);
      await glideTo(page, locator);
      await locator.click({timeout: actionTimeout});
      await waitForPostcondition(page, input.postcondition);
      assertPageHost(page, hosts);
      break;
    }
    case "fill": {
      const locator = page.locator(input.selector);
      await glideTo(page, locator);
      await locator.click({timeout: actionTimeout});
      await locator.pressSequentially(input.value, {delay: 60, timeout: actionTimeout});
      await waitForPostcondition(page, input.postcondition);
      break;
    }
    case "hover": {
      const locator = page.locator(input.selector);
      await glideTo(page, locator);
      await locator.hover({timeout: actionTimeout});
      break;
    }
    case "press":
      await page.keyboard.press(input.key); break;
    case "select": {
      const locator = pointLocator(page, input);
      const box = await glideTo(page, locator);
      const y = box.y + Math.min(Math.max(box.height / 2, 4), Math.max(box.height - 4, 4));
      const from = box.x + Math.min(10, Math.max(2, box.width * 0.06));
      const to = box.x + box.width - Math.min(10, Math.max(2, box.width * 0.06));
      await page.mouse.move(from, y, {steps: 8});
      await page.mouse.down();
      await page.mouse.move(to, y, {steps: 14});
      await page.mouse.up();
      break;
    }
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

const leadMs = (item: Plan["beats"][number]) => item.steps.some((input) => input.action === "goto") ? 5_000 : 2_200;

const main = async () => {
  const planPath = process.argv[2];
  if (!planPath) throw new Error("Usage: tsx scripts/record-demo.ts <demo-plan.json>");
  if (!existsSync("public/captions.json")) throw new Error("Missing public/captions.json. Run generate-tts.ts before recording.");
  if (!existsSync("public/narration.mp3")) throw new Error("Missing public/narration.mp3. Run generate-tts.ts before recording.");
  const plan = planSchema.parse(JSON.parse(readFileSync(resolve(planPath), "utf8")));
  const captions = captionsSchema.parse(JSON.parse(readFileSync("public/captions.json", "utf8"))) as Caption[];
  if (!captions.length) throw new Error("public/captions.json is empty");
  const hosts = planHosts(plan);
  if (!allowedUrl(plan.startUrl, hosts)) throw new Error("startUrl must be http(s)");
  const cues = plan.beats.map((item) => matchCue(item.cue, captions));
  for (let index = 1; index < cues.length; index++) {
    if (cues[index].startMs <= cues[index - 1].startMs) throw new Error("Beat cues must occur once and in narration order");
  }
  const narrationEndMs = narrationDurationMs(captions);
  mkdirSync("artifacts/recordings", {recursive: true});
  mkdirSync("public", {recursive: true});
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: plan.viewport, recordVideo: {dir: resolve("artifacts/recordings"), size: plan.viewport}});
  await context.addInitScript(installCursor);
  let page: Page | undefined;
  let video: Awaited<ReturnType<Page["video"]>>;
  try {
    const videoStartNs = process.hrtime.bigint();
    page = await context.newPage();
    video = page.video();
    const runSetup = async (item: Plan["beats"][number]) => {
      for (const input of item.steps.filter((stepInput) => isSetup(stepInput.action))) await runStep(page!, input, hosts);
    };
    const runInspect = async (item: Plan["beats"][number]) => {
      for (const input of item.steps.filter((stepInput) => !isSetup(stepInput.action))) await runStep(page!, input, hosts);
    };

    await loadPage(page, plan.startUrl, hosts);
    await runSetup(plan.beats[0]);
    await approachTarget(page, plan.beats[0].target, plan.viewport.height);
    const first = await measureBeat(page, plan.beats[0], plan.viewport);
    const originNs = process.hrtime.bigint();
    const demoOffsetMs = Number(originNs - videoStartNs) / 1e6;
    const emphasis: EmphasisBeat[] = [{...first, startMs: 0, endMs: cues[0].endMs, approachStartMs: 0}];
    await runInspect(plan.beats[0]);
    for (let index = 1; index < plan.beats.length; index++) {
      const cueStartNs = originNs + BigInt(Math.round(cues[index].startMs * 1e6));
      await waitUntil(page, originNs + BigInt(Math.round(Math.max(0, cues[index].startMs - leadMs(plan.beats[index])) * 1e6)));
      const approachStartMs = Number(process.hrtime.bigint() - originNs) / 1e6;
      await runSetup(plan.beats[index]);
      await approachTarget(page, plan.beats[index].target, plan.viewport.height);
      const arrivedMs = Number(process.hrtime.bigint() - originNs) / 1e6;
      if (arrivedMs > cues[index].startMs + approachOverrunMs) throw new Error(`Approach for cue "${plan.beats[index].cue}" overran its cue by ${Math.round(arrivedMs - cues[index].startMs)}ms`);
      const focused = await measureBeat(page, plan.beats[index], plan.viewport);
      emphasis.push({...focused, startMs: arrivedMs, endMs: cues[index].endMs, approachStartMs});
      await waitUntil(page, cueStartNs);
      await runInspect(plan.beats[index]);
      const nextDeadline = index + 1 < cues.length ? cues[index + 1].startMs : narrationEndMs;
      const inspectEnd = Number(process.hrtime.bigint() - originNs) / 1e6;
      if (inspectEnd > nextDeadline + inspectOverrunMs) throw new Error(`Inspect for cue "${plan.beats[index].cue}" overran the next cue by ${Math.round(inspectEnd - nextDeadline)}ms`);
    }
    for (let index = 0; index < emphasis.length - 1; index++) emphasis[index].endMs = emphasis[index + 1].approachStartMs;
    emphasis[emphasis.length - 1].endMs = narrationEndMs;
    await waitUntil(page, originNs + BigInt(Math.round(narrationEndMs * 1e6)));
    writeFileSync("public/emphasis.json", `${JSON.stringify({demoOffsetMs, transitionMs: approachDurationMs, beats: emphasis}, null, 2)}\n`);
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
