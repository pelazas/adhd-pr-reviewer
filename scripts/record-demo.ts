import "dotenv/config";
import {execFileSync} from "node:child_process";
import {mkdirSync, existsSync} from "node:fs";
import {resolve} from "node:path";
import {chromium, type Page} from "playwright";
import {z} from "zod";

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
const planSchema = z.object({
  startUrl: z.string().url(),
  viewport: z.object({width: z.number().int().positive(), height: z.number().int().positive()}),
  steps: z.array(step).min(1).max(12),
});
type Plan = z.infer<typeof planSchema>;
const actionTimeout = 15_000;

const allowedUrl = (target: string, startUrl: string) => {
  const url = new URL(target);
  const start = new URL(startUrl);
  return ["http:", "https:"].includes(url.protocol) && (url.hostname === start.hostname || url.hostname === "localhost" || url.hostname === "127.0.0.1");
};

const locatorFor = (page: Page, input: Extract<Plan["steps"][number], {action: "click"}>) => {
  if (input.selector) return page.locator(input.selector);
  if (input.text) return page.getByText(input.text, {exact: true});
  if (input.role && input.name) return page.getByRole(input.role as never, {name: input.name});
  throw new Error("click needs selector, text, or role and name");
};

const waitForPostcondition = async (page: Page, value: z.infer<typeof postcondition>) => {
  if (value.selector) await page.locator(value.selector).waitFor({state: "visible", timeout: actionTimeout});
  if (value.text) await page.getByText(value.text, {exact: false}).waitFor({state: "visible", timeout: actionTimeout});
  if (value.urlIncludes) await page.waitForURL(`**${value.urlIncludes}**`, {timeout: actionTimeout});
};

const slowScroll = async (page: Page, y: number, durationMs = 4_500) => {
  const start = await page.evaluate("window.scrollY") as number;
  const ticks = 45;
  for (let index = 1; index <= ticks; index++) {
    const progress = index / ticks;
    const eased = 1 - Math.pow(1 - progress, 3);
    await page.evaluate(`window.scrollTo(0, ${start + (y - start) * eased})`);
    await page.waitForTimeout(durationMs / ticks);
  }
};

const runStep = async (page: Page, input: Plan["steps"][number], startUrl: string) => {
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

const main = async () => {
  const planPath = process.argv[2];
  if (!planPath) throw new Error("Usage: tsx scripts/record-demo.ts <demo-plan.json>");
  const plan = planSchema.parse(JSON.parse(await (await import("node:fs/promises")).readFile(resolve(planPath), "utf8")));
  if (!allowedUrl(plan.startUrl, plan.startUrl)) throw new Error("startUrl must be http(s)");
  mkdirSync("artifacts/recordings", {recursive: true});
  mkdirSync("public", {recursive: true});
  const browser = await chromium.launch({headless: true, slowMo: 250});
  const context = await browser.newContext({viewport: plan.viewport, recordVideo: {dir: resolve("artifacts/recordings"), size: plan.viewport}});
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.goto(plan.startUrl, {waitUntil: "domcontentloaded", timeout: actionTimeout});
    for (const input of plan.steps) await runStep(page, input, plan.startUrl);
  } catch (error) {
    mkdirSync("artifacts", {recursive: true});
    await page.screenshot({path: "artifacts/failure.png", fullPage: true}).catch(() => undefined);
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
  console.log("Created public/demo.mp4 and public/demo-last.png");
};

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
