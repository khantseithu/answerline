import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseEvalSuite } from "@answerline/shared";

const SUITE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EXTENSION = ".yaml";

export class EvalSuiteNotFoundError extends Error {
  constructor() {
    super("Eval suite not found");
  }
}

export function findEvalsDir(start = process.cwd()) {
  let directory = resolve(start);
  for (;;) {
    const candidate = join(directory, "evals");
    if (existsSync(join(directory, "pnpm-workspace.yaml")) && existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find the repository evals directory");
    }
    directory = parent;
  }
}

export async function listEvalSuites(evalsDir: string) {
  const filenames = await readdir(evalsDir);
  return filenames
    .filter((filename) => filename.endsWith(EXTENSION))
    .map((filename) => filename.slice(0, -EXTENSION.length))
    .filter((name) => SUITE_NAME.test(name))
    .sort();
}

export async function readEvalSuite(evalsDir: string, name: string) {
  if (!SUITE_NAME.test(name)) {
    throw new EvalSuiteNotFoundError();
  }
  const suites = await listEvalSuites(evalsDir);
  if (!suites.includes(name)) {
    throw new EvalSuiteNotFoundError();
  }
  return parseEvalSuite(await readFile(join(evalsDir, `${name}${EXTENSION}`), "utf8"));
}
