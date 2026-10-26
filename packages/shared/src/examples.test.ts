import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "./agent-config.ts";
import { parseEvalSuite } from "./eval-suite.ts";

const root = new URL("../../../", import.meta.url);
const agentFiles = (await readdir(new URL("agents/", root)))
  .filter((file) => file.endsWith(".yaml"))
  .sort();

const evalFiles = (await readdir(new URL("evals/", root)))
  .filter((file) => file.endsWith(".yaml"))
  .sort();

const LANGUAGE_SUITE = /^(.+)-([a-z]{2,3})\.yaml$/;

const catalog = await readFile(new URL("agents/README.md", root), "utf8");

test("business template library has matching evals and unique agent names", async () => {
  assert.ok(agentFiles.length >= 30);
  assert.deepEqual(
    evalFiles.filter((file) => agentFiles.includes(file)),
    agentFiles
  );
  const names = await Promise.all(
    agentFiles.map(async (file) => {
      const config = parseAgentConfig(await readFile(new URL(`agents/${file}`, root), "utf8"));
      return config.name;
    })
  );
  assert.equal(new Set(names).size, names.length);
});

for (const file of evalFiles.filter((name) => !agentFiles.includes(name))) {
  test(`${file} is a language suite for a declared agent language`, async () => {
    const match = LANGUAGE_SUITE.exec(file);
    assert.ok(match?.[1] && match[2], `${file} must be named <agent>-<language>.yaml`);
    const config = parseAgentConfig(
      await readFile(new URL(`agents/${match[1]}.yaml`, root), "utf8")
    );
    assert.ok(config.languages?.[match[2]], `${match[1]} must declare language ${match[2]}`);
    const suite = parseEvalSuite(await readFile(new URL(`evals/${file}`, root), "utf8"));
    assert.ok(suite.every((scenario) => scenario.expect.judge?.trim()));
    assert.ok(catalog.includes(`](../evals/${file})`));
  });
}

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
