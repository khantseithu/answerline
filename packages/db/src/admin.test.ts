import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initializeAuthEnvironment, parseAdminEnvironment } from "./admin.ts";

test("admin environment accepts a blank stored auth secret and preserves other settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "answerline-admin-"));
  const path = join(directory, ".env");
  try {
    await writeFile(path, "KEEP_ME=value\nBETTER_AUTH_SECRET=\nBETTER_AUTH_URL=\n");
    const environment = parseAdminEnvironment({
      BETTER_AUTH_SECRET: "",
      DATABASE_URL: "postgres://answerline:answerline@localhost:5432/answerline",
      PORT: "3013",
    });
    const result = await initializeAuthEnvironment(path, environment);
    const contents = await readFile(path, "utf8");
    const lines = contents.split("\n");
    assert.ok(lines.includes("KEEP_ME=value"));
    assert.ok(lines.some((line) => line.startsWith("BETTER_AUTH_SECRET=") && line.length > 19));
    assert.ok(lines.includes("BETTER_AUTH_URL=http://localhost:3013"));
    assert.equal(result.baseURL, "http://localhost:3013");
    assert.ok(result.secret.length >= 32);
    assert.equal((await stat(path)).mode.toString(8).slice(-3), "600");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
