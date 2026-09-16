#!/usr/bin/env node
// Read-only size inventory for explicitly selected text files; never walks directories.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function measureContext(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("Specify the files selected for this task; directories are not accepted.");
  }
  const seen = new Set();
  const files = [];
  for (const path of paths) {
    const canonical = realpathSync(path);
    if (!statSync(canonical).isFile()) throw new Error(`Not a regular file: ${path}`);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const bytes = readFileSync(canonical);
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes("\0")) throw new Error(`Not a text file: ${path}`);
    files.push({
      path,
      characters: [...content].length,
      bytes: bytes.length,
      lines: content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length - (/\r?\n$|\r$/.test(content) ? 1 : 0),
    });
  }
  return {
    scope: "explicit_files_deduplicated",
    measurement: "unicode_code_points_and_utf8_bytes",
    tokens: "unknown",
    runtime_input: "not_observed",
    files,
    totals: files.reduce((sum, file) => ({
      characters: sum.characters + file.characters,
      bytes: sum.bytes + file.bytes,
      lines: sum.lines + file.lines,
    }), { characters: 0, bytes: 0, lines: 0 }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node validators/measure-context.mjs -- <file> [file ...]\nCounts selected UTF-8 files once; no recursion, token estimate, writes or model calls. Run separately for planning, framework, task and history inputs.");
  } else {
    try {
      if (args[0] !== "--") throw new Error("Use -- before an explicit list of files (see --help).");
      console.log(JSON.stringify(measureContext(args.slice(1)), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
