import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "./agent-config.ts";
import { parseEvalSuite } from "./eval-suite.ts";

const root = new URL("../../../", import.meta.url);
const agentFiles = (await readdir(new URL("agents/", root)))
  .filter((file) => file.endsWith(".yaml"))
  .sort();

const catalog = await readFile(new URL("agents/README.md", root), "utf8");

test("business template library has matching evals and unique agent names", async () => {
  assert.ok(agentFiles.length >= 30);
  const evalFiles = (await readdir(new URL("evals/", root)))
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  assert.deepEqual(evalFiles, agentFiles);
  const names = await Promise.all(
    agentFiles.map(async (file) => {
      const config = parseAgentConfig(await readFile(new URL(`agents/${file}`, root), "utf8"));
      return config.name;
    })
  );
  assert.equal(new Set(names).size, names.length);
});

for (const file of agentFiles) {
  test(`${file} parses with a documented workflow and matching eval suite`, async () => {
    const config = parseAgentConfig(await readFile(new URL(`agents/${file}`, root), "utf8"));
    const suite = parseEvalSuite(await readFile(new URL(`evals/${file}`, root), "utf8"));
    assert.ok(config.hours);
    assert.equal(config.recording.enabled, false);
    assert.ok(catalog.includes(`](./${file})`));
    assert.ok(catalog.includes(`](../evals/${file})`));
    assert.ok(suite.some((scenario) => scenario.expect.tool_called === "capture_lead"));
    assert.ok(suite.some((scenario) => scenario.expect.tool_called === "take_voicemail"));
    assert.ok(suite.every((scenario) => scenario.expect.judge?.trim()));
    assert.equal(new Set(suite.map((scenario) => scenario.name)).size, suite.length);
  });
}

test("rejects model without provider", () => {
  assert.throws(() =>
    parseAgentConfig(
      "name: x\ngreeting: hi\ninstructions: be nice\nmodels:\n  stt: nova\n  llm:\n    primary: anthropic/claude-sonnet\n  tts: cartesia/sonic\n"
    )
  );
});
