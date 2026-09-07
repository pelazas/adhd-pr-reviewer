import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parsePrRef, requireComment, resolvePrRef} from "./post-pr";

assert.deepEqual(parsePrRef("pelazas/app#3"), ["3", "-R", "pelazas/app"]);
assert.deepEqual(parsePrRef("https://github.com/pelazas/app/pull/3"), ["https://github.com/pelazas/app/pull/3"]);
assert.throws(() => parsePrRef("not-a-pr"), /Usage:/);

assert.deepEqual(resolvePrRef(["node", "post-pr.ts", "acme/app#9"], {}), ["9", "-R", "acme/app"]);
assert.deepEqual(resolvePrRef(["node", "post-pr.ts"], {ADHD_PR: "acme/app#9"}), ["9", "-R", "acme/app"]);
assert.deepEqual(resolvePrRef(["node", "post-pr.ts", "acme/app#2"], {ADHD_PR: "acme/app#9"}), ["2", "-R", "acme/app"]);
assert.throws(() => resolvePrRef(["node", "post-pr.ts"], {}), /Usage:/);

const dir = mkdtempSync(join(tmpdir(), "post-pr-"));
assert.throws(() => requireComment(join(dir, "missing.md")), /Missing/);
const empty = join(dir, "empty.md");
writeFileSync(empty, "  \n");
assert.throws(() => requireComment(empty), /Missing/);
const take = join(dir, "comment.md");
const body = "Review take: the filter works.\n";
writeFileSync(take, body);
requireComment(take);
assert.equal(readFileSync(take, "utf8"), body);
rmSync(dir, {recursive: true});
