import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EvalSuiteNotFoundError, findEvalsDir, listEvalSuites, readEvalSuite } from "./suites.ts";

const SUITE = `- name: greets
  caller: Hello?
  expect:
    mentions: [hello]
`;

async function withEvalsDir(run: (evalsDir: string, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "answerline-evals-"));
  const evalsDir = join(root, "evals");
  try {
    await mkdir(evalsDir);
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    await writeFile(join(root, "secret.yaml"), SUITE);
    await writeFile(join(evalsDir, "dental.yaml"), SUITE);
    await writeFile(join(evalsDir, "Bad Name.yaml"), SUITE);
    await writeFile(join(evalsDir, "notes.txt"), "ignored");
    await run(evalsDir, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("finds the repository evals directory from a nested cwd", () =>
  withEvalsDir(async (evalsDir, root) => {
    const nested = join(root, "apps", "web");
    await mkdir(nested, { recursive: true });
    assert.equal(findEvalsDir(nested), evalsDir);
    assert.equal(findEvalsDir(root), evalsDir);
  }));

test("finds this repository's evals directory from the web app", async () => {
  assert.ok((await listEvalSuites(findEvalsDir())).includes("bright-smile-dental"));
});

test("lists only safe yaml suite basenames", () =>
  withEvalsDir(async (evalsDir) => {
    assert.deepEqual(await listEvalSuites(evalsDir), ["dental"]);
  }));

test("reads a listed suite and rejects anything outside the evals directory", () =>
  withEvalsDir(async (evalsDir) => {
    const cases = await readEvalSuite(evalsDir, "dental");
    assert.equal(cases[0]?.name, "greets");
    await Promise.all(
      ["../secret", "secret", "dental.yaml", "Bad Name", "", "/etc/passwd"].map((name) =>
        assert.rejects(readEvalSuite(evalsDir, name), EvalSuiteNotFoundError)
      )
    );
  }));
