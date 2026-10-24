import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentYaml } from "./config.ts";

const templatesDirectory = new URL("../../../../../agents/", import.meta.url);
const GREETING_LINE = /^greeting:.*$/m;

function readTemplate(filename: string) {
  return readFile(new URL(filename, templatesDirectory), "utf8");
}

test("accepts every example agent template", async () => {
  const filenames = (await readdir(templatesDirectory)).filter((name) => name.endsWith(".yaml"));
  assert.equal(filenames.length, 30);
  const sources = await Promise.all(filenames.map(readTemplate));
  for (const [index, source] of sources.entries()) {
    assert.equal(parseAgentYaml(source).ok, true, filenames[index]);
  }
});

test("returns the parsed config for valid YAML", async () => {
  const result = parseAgentYaml(await readTemplate("bright-smile-dental.yaml"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.config.greeting.length > 0);
  }
});

test("reports YAML syntax errors instead of throwing", () => {
  const result = parseAgentYaml("name: [unclosed");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.length > 0);
  }
});

test("reports the first schema issue for well-formed YAML", async () => {
  const source = await readTemplate("bright-smile-dental.yaml");
  const result = parseAgentYaml(source.replace(GREETING_LINE, "greeting: ''"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.notEqual(result.error, "");
  }
});
