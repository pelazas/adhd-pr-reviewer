import assert from "node:assert/strict";
import {buildBrief, isFrontend, isNoise, parseNdjsonFiles, parsePrRef, renderHunk} from "./fetch-pr-brief";

assert.equal(isNoise("package-lock.json"), true);
assert.equal(isNoise("dist/app.js.map"), true);
assert.equal(isNoise("src/App.tsx"), false);
assert.equal(isFrontend("src/App.tsx"), true);
assert.equal(isFrontend("package-lock.json"), false);
assert.equal(isFrontend("src/app.test.tsx"), false);
assert.deepEqual(parsePrRef("pelazas/portfolio#1"), ["1", "-R", "pelazas/portfolio"]);
assert.deepEqual(parsePrRef("https://github.com/pelazas/portfolio/pull/1"), ["https://github.com/pelazas/portfolio/pull/1"]);

const hunk = renderHunk(["@@ -1,4 +1,5 @@", "-old", " keep", "+hello"]);
assert.match(hunk, /\+hello/);
assert.match(hunk, /⋯/);

const diff = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "lock": true
 }
diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,4 @@
 export const App = () => {
+  return <h1>Hello</h1>;
 };
diff --git a/dist/app.js.map b/dist/app.js.map
--- a/dist/app.js.map
+++ b/dist/app.js.map
@@ -1 +1 @@
-{}
+{"version":3}
`;

const brief = buildBrief({
  number: 1,
  title: "Add hello heading",
  body: "Shows a heading on the home page.",
  url: "https://github.com/acme/app/pull/1",
  files: [
    {path: "package-lock.json", additions: 1, deletions: 0},
    {path: "src/App.tsx", additions: 1, deletions: 0},
    {path: "dist/app.js.map", additions: 1, deletions: 1},
  ],
  additions: 3,
  deletions: 1,
  changedFiles: 3,
}, diff);

assert.match(brief, /src\/App\.tsx/);
assert.match(brief, /Hello/);
assert.match(brief, /one sentence: Shows a heading on the home page\./);
assert.doesNotMatch(brief, /package-lock/);
assert.doesNotMatch(brief, /app\.js\.map/);
assert.doesNotMatch(brief, /No frontend-looking files/);

const backendOnly = buildBrief({
  number: 2,
  title: "Fix query",
  body: "<!-- template -->\nSpeeds up the lookup.",
  url: "https://github.com/acme/app/pull/2",
  files: [{path: "server/db.go", additions: 4, deletions: 1}],
  additions: 4,
  deletions: 1,
  changedFiles: 1,
}, `diff --git a/server/db.go b/server/db.go
--- a/server/db.go
+++ b/server/db.go
@@ -1,2 +1,3 @@
 package db
+func Fast() {}
`);
assert.match(backendOnly, /No frontend-looking files/);
assert.match(backendOnly, /server\/db\.go/);
assert.doesNotMatch(backendOnly, /template/);

assert.deepEqual(
  parseNdjsonFiles('{"filename":"src/App.tsx","additions":1,"deletions":0}\n{"path":"src/ui.ts","additions":2,"deletions":1}\nnot-json\n'),
  [
    {path: "src/App.tsx", additions: 1, deletions: 0},
    {path: "src/ui.ts", additions: 2, deletions: 1},
  ],
);

const fromFilename = buildBrief({
  number: 3,
  title: "Add hello heading",
  body: "Shows a heading on the home page.",
  url: "https://github.com/acme/app/pull/3",
  files: [{filename: "src/App.tsx", additions: 1, deletions: 0}],
}, diff);
assert.match(fromFilename, /src\/App\.tsx/);
assert.match(fromFilename, /Hello/);

console.log("ok");
