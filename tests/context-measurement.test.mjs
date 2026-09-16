import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { measureContext } from "../validators/measure-context.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "agt-context-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("counts multilingual text without reporting estimated tokens or runtime usage", t => {
  const dir = fixture(t), file = join(dir, "状态.md"), empty = join(dir, "empty.md");
  writeFileSync(file, "中😀\r\nA\n");
  writeFileSync(empty, "");
  const result = measureContext([file, empty]);
  assert.deepEqual(result.totals, { characters: 6, bytes: 11, lines: 2 });
  assert.equal(result.tokens, "unknown");
  assert.equal(result.runtime_input, "not_observed");
  assert.equal(result.files[1].lines, 0);
  writeFileSync(empty, "\uFEFF");
  assert.equal(measureContext([empty]).totals.characters, 1);
});

test("deduplicates repeated paths and symlinks; does not follow document links", t => {
  const dir = fixture(t), file = join(dir, "entry.md"), alias = join(dir, "alias.md");
  const content = "[history](missing-history.md)\n";
  writeFileSync(file, content);
  symlinkSync(file, alias);
  const result = measureContext([file, file, alias]);
  assert.equal(result.files.length, 1);
  assert.equal(result.totals.characters, content.length);
  assert.equal(readFileSync(file, "utf8"), content);
});

test("rejects directories and missing files instead of silently undercounting", t => {
  const dir = fixture(t);
  assert.throws(() => measureContext([]), /Specify/);
  assert.throws(() => measureContext([dir]), /regular file/);
  assert.throws(() => measureContext([join(dir, "missing.md")]), /ENOENT/);
});

test("rejects invalid UTF-8 and binary NUL content", t => {
  const dir = fixture(t), file = join(dir, "binary");
  writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => measureContext([file]));
  writeFileSync(file, "text\0binary");
  assert.throws(() => measureContext([file]), /text file/);
});

test("CLI requires explicit inputs and emits no partial totals on failure", t => {
  const dir = fixture(t), file = join(dir, "current plan.md");
  const script = resolve(import.meta.dirname, "../validators/measure-context.mjs");
  writeFileSync(file, "one\rtwo");
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  let result = run(["--", file]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).totals.lines, 2);
  for (const args of [[], ["--"], ["--", file, join(dir, "missing")], ["--", dir]]) {
    result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
  assert.equal(run(["--help"]).status, 0);
});
