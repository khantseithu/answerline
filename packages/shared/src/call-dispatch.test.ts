import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { callDispatchMetadataSchema } from "./call-dispatch.ts";
import { jsonSchema, schemaPath } from "./generate-json-schema.ts";

for (const kind of ["valid", "invalid"]) {
  test(`call dispatch ${kind} fixtures`, async () => {
    const directory = new URL(`../fixtures/call-dispatch/${kind}/`, import.meta.url);
    const files = await readdir(directory);
    const fixtures = await Promise.all(
      files.map(async (file) => ({
        data: JSON.parse(await readFile(new URL(file, directory), "utf8")) as unknown,
        file,
      }))
    );
    for (const { data, file } of fixtures) {
      const result = callDispatchMetadataSchema.safeParse(data);
      assert.equal(result.success, kind === "valid", file);
      if (result.success) {
        assert.deepEqual(result.data, data);
      }
    }
  });
}

test("committed call dispatch JSON Schema matches Zod", async () => {
  assert.equal(await readFile(schemaPath("call-dispatch"), "utf8"), jsonSchema("call-dispatch"));
});
