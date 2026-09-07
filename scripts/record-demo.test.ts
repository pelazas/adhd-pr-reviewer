import assert from "node:assert/strict";
import {prChipLabel} from "./record-demo";

assert.equal(
  prChipLabel("https://github.com/pelazas/adhd-fixture-2026-09-07-inkboard-status-filter/pull/1"),
  "PR #1 · pelazas/adhd-fixture-2026-09-07-inkboard-status-filter",
);
assert.equal(prChipLabel("https://pelazas.com/"), undefined);

console.log("ok");
