import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const encryptedValue = /encrypted:/;
const workspaceCommand = /^dotenvx run -f \.\.\/\.\.\/\.env -- /;
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(
  dirname(fileURLToPath(import.meta.resolve("@dotenvx/dotenvx/package.json"))),
  "src/cli/dotenvx.js"
);

const run = (args, cwd, env = process.env) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const probe = 'process.stdout.write(process.env.ANSWERLINE_ENV_TEST_VALUE ?? "missing")';

test("dotenvx loads plaintext and encrypted values from each Node workspace", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "answerline-env-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const file = join(directory, ".env");
  writeFileSync(file, 'ANSWERLINE_ENV_TEST_VALUE="dev value with spaces # literal"\n');
  const args = ["run", "--quiet", "--strict", "-f", file, "--", "node", "-e", probe];
  for (const workspace of ["apps/web", "apps/worker", "packages/db"]) {
    assert.equal(run(args, join(root, workspace)), "dev value with spaces # literal");
  }
  run(["encrypt", "-f", file], directory);
  assert.match(readFileSync(file, "utf8"), encryptedValue);
  for (const workspace of ["apps/web", "apps/worker", "packages/db", ""]) {
    assert.equal(run(args, join(root, workspace)), "dev value with spaces # literal");
  }
  assert.equal(
    run(args, root, { ...process.env, ANSWERLINE_ENV_TEST_VALUE: "injected" }),
    "injected"
  );
});

test("dotenvx entry points load after Turbo filtering and before uv", () => {
  const manifest = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const { scripts } = manifest("package.json");
  assert.equal(scripts["agent:dev"], "dotenvx run -- uv run answerline-agent dev");
  assert.equal(scripts.dev, "turbo run dev");
  for (const path of ["apps/web/package.json", "apps/worker/package.json"]) {
    for (const name of ["dev", "start"]) {
      assert.match(manifest(path).scripts[name], workspaceCommand);
    }
  }
});

const exampleVariable = /^#?\s*([A-Z][A-Z0-9_]*)=/gm;
const schemaVariable = /^\s{2,}([A-Z][A-Z0-9_]+):/gm;
const composeVariable = /\$\{([A-Z][A-Z0-9_]*)/g;
const settingsClass = /^class \w+\(BaseSettings\):/;
const settingsField = /^ {4}([a-z][a-z0-9_]*):/;

const exampleVariables = (path) =>
  new Set([...readFileSync(join(root, path), "utf8").matchAll(exampleVariable)].map((m) => m[1]));

test("environment examples cover configuration schemas and Compose inputs", () => {
  const declared = exampleVariables(".env.example");
  const required = new Set();
  for (const path of [
    "apps/web/src/env.ts",
    "apps/worker/src/env.ts",
    "apps/worker/src/phone-numbers.ts",
    "apps/worker/src/twilio.ts",
    "apps/worker/src/telnyx.ts",
    "packages/db/src/admin.ts",
    "packages/llm/src/embeddings.ts",
  ]) {
    for (const match of readFileSync(join(root, path), "utf8").matchAll(schemaVariable)) {
      required.add(match[1]);
    }
  }
  for (const path of [
    "apps/agent/src/answerline_agent/settings.py",
    "apps/agent/src/answerline_agent/recording.py",
    "packages/llm/python/src/answerline_llm/embeddings.py",
  ]) {
    let inSettings = false;
    for (const line of readFileSync(join(root, path), "utf8").split("\n")) {
      if (settingsClass.test(line)) {
        inSettings = true;
        continue;
      }
      if (line && !line.startsWith(" ")) {
        inSettings = false;
      }
      const field = inSettings && settingsField.exec(line);
      if (field) {
        required.add(field[1].toUpperCase());
      }
    }
  }
  for (const path of ["docker-compose.yml", "docker-compose.production.yml"]) {
    for (const match of readFileSync(join(root, path), "utf8").matchAll(composeVariable)) {
      required.add(match[1]);
    }
  }
  for (const name of required) {
    assert.ok(declared.has(name), `${name} is missing from .env.example`);
  }
  for (const name of exampleVariables(".env.production.example")) {
    assert.ok(declared.has(name), `${name} is missing from .env.example`);
  }
});

test("every example environment variable has a reference entry", () => {
  const reference = readFileSync(join(root, "docs/deploy/environment.md"), "utf8");
  for (const name of exampleVariables(".env.example")) {
    assert.ok(
      reference.includes(`\`${name}\``),
      `${name} is missing from the environment reference`
    );
  }
});
