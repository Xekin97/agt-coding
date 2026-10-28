#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { assert, git } from "../workstreams/context.mjs";
import * as delivery from "./delivery.mjs";

const help = `agt-delivery <command> --project PATH [options]
  init --input FILE                  Adopt schema 2 branch planning; preserves tracked planning
  start --id UNIT --path NEW_PATH --approval SOURCE [--predecessor M001]
                                    Create milestone/Quick branch and worktree from main
  inventory --id UNIT [--input FILE] List this unit's current files; does not classify or delete
  review --id UNIT --input FILE      Record current/unknown owner-reviewed materials after cleanup
  close --id UNIT --input FILE       Record final accepted content; no archive is generated
  adopt-closed --id UNIT --input FILE
                                    Explicit one-time cleanup preserving historical acceptance
  consolidate --id PARENT --child CHILD --reason TEXT
                                    Retire child summary after reviewed parent consolidation
  show --id UNIT                     Read final outcome, limits, closed state and delivery commit
  check [--staged] [--base COMMIT] [--maintenance FILE]
                                    Check final material and reject closed-scope changes
  prepare --id UNIT [--maintenance FILE]
                                    Prepare a squash candidate from an accepted parent branch
  verify --id UNIT --input FILE      Run explicit check argv arrays against the exact candidate
  finish --id UNIT                   Update main only after fresh successful candidate checks
  extract --id UNIT --destination PATH
                                    Explicit read-only legacy archive recovery only
UNIT is M001, Q001-slug, M001-child or Q001-parent--child.
Final squash accepts only milestone/Quick parents. Child workstreams merge to their parent.
No command pushes, deploys or launches agents. start/prepare/finish change Git.
prepare removes only the delivered parent's live workstream binding; roles clean content.
See core/delivery.md for contracts.`;
try {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: "string" }, id: { type: "string" }, input: { type: "string" }, base: { type: "string" },
    staged: { type: "boolean" }, path: { type: "string" }, destination: { type: "string" }, predecessor: { type: "string" },
    child: { type: "string" }, reason: { type: "string" }, approval: { type: "string" }, maintenance: { type: "string" }, help: { type: "boolean" },
  } });
  if (v.help || !positionals.length) process.stdout.write(help + "\n");
  else {
    assert(positionals.length === 1 && v.project, "One command and --project are required");
    const root = git(resolve(v.project), ["rev-parse", "--show-toplevel"]), command = positionals[0];
    const input = () => { assert(v.input, "--input is required"); return JSON.parse(readFileSync(v.input, "utf8")); };
    const maintenance = v.maintenance ? JSON.parse(readFileSync(v.maintenance, "utf8")) : undefined;
    let result;
    if (command === "init") result = delivery.initialize(root, input());
    else if (command === "start") result = delivery.start(root, v);
    else if (command === "inventory") result = delivery.inventory(root, v.id, v.input ? input() : {});
    else if (command === "review") result = delivery.review(root, v.id, input());
    else if (command === "close") result = delivery.close(root, v.id, input());
    else if (command === "adopt-closed") result = delivery.adoptClosed(root, v.id, input());
    else if (command === "consolidate") result = delivery.consolidate(root, v);
    else if (command === "show") result = delivery.show(root, v.id);
    else if (command === "check") result = delivery.checkGit(root, { staged: !!v.staged, base: v.base, maintenance });
    else if (command === "prepare") result = delivery.prepare(root, { id: v.id, maintenance });
    else if (command === "verify") result = delivery.verify(root, { id: v.id, ...input() });
    else if (command === "finish") result = delivery.finish(root, { id: v.id });
    else if (command === "extract") { assert(v.destination, "--destination is required"); result = delivery.extract(root, v.id, v.destination); }
    else throw Error(`Unknown command: ${command}`);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
