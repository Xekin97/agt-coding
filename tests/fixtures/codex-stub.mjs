#!/usr/bin/env node
import readline from "node:readline";
import { writeFileSync } from "node:fs";
const mode = process.env.AGT_TEST_SCENARIO;
if (process.argv[2] === "--version") { console.log("codex-cli fixture"); process.exit(0); }
if (process.argv[2] === "exec") {
 let input = ""; for await (const chunk of process.stdin) input += chunk;
 writeFileSync(process.env.AGT_TEST_OUTPUT, JSON.stringify({ args: process.argv.slice(2), input }));
 if (process.argv.includes("--json")) {
  console.log(JSON.stringify({type:"thread.started",thread_id:"fixture-runtime"}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}));
 }
 process.exit(Number(process.env.AGT_TEST_EXIT || 0));
}
if (process.argv[2] !== "app-server") process.exit(9);
const stream = readline.createInterface({ input: process.stdin });
stream.on("line", line => {
 const msg = JSON.parse(line);
 if (!["initialize", "initialized", "model/list"].includes(msg.method)) process.exit(8);
 if (mode === "timeout") return;
 if (msg.method === "initialized") return;
 if (mode === "error") { console.log(JSON.stringify({id:msg.id,error:{message:"fixture error"}})); return; }
 if (mode === "malformed") { console.log("not-json"); return; }
 if (msg.method === "initialize") { console.log(JSON.stringify({id:msg.id,result:{}})); return; }
 const models = ["gpt-6.1-sol","gpt-6-astra","gpt-6-sol","gpt-6-luna"].map(model=>({model,hidden:false,supportedReasoningEfforts:["low","medium","high","xhigh","max",...(model === "gpt-6-luna" ? [] : ["ultra"])].map(reasoningEffort => ({reasoningEffort}))}));
 const first = !msg.params.cursor;
 const result = mode === "cycle" ? {data:models.slice(0,1),nextCursor:"same"} :
   first ? {data:models.slice(0,2),nextCursor:"second"} : {data:models.slice(2),nextCursor:null};
 console.log(JSON.stringify({id:msg.id,result}));
});
