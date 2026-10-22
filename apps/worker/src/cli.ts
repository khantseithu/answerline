import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseAgentConfig, parseEvalSuite } from "@answerline/shared";

const [command, agentFile] = process.argv.slice(2);

if (command !== "eval" || !agentFile) {
  console.error("usage: worker eval <agents/name.yaml>");
  process.exit(1);
}

const suiteFile = join(dirname(agentFile), "..", "evals", basename(agentFile));
const agent = parseAgentConfig(await readFile(agentFile, "utf8"));
const suite = parseEvalSuite(await readFile(suiteFile, "utf8"));

console.log(`${agent.name}: ${suite.length} eval cases from ${suiteFile}`);
for (const c of suite) {
  console.log(`- ${c.name}`);
}
console.error("eval runner not implemented yet");
process.exit(1);
