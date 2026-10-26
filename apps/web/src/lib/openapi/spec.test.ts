import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentSchema } from "@answerline/shared";
import { z } from "zod";
import { GET } from "@/app/api/docs/route";

const schemaRefPattern = /^#\/components\/schemas\/(.+)$/;

test("the docs route serves an OpenAPI spec generated from the API Zod schemas", async () => {
  const response = GET();
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.oai.openapi+json;version=3.1.0"
  );
  assert.equal(response.headers.get("cache-control"), "no-store");

  const spec = (await response.json()) as {
    components: { schemas: Record<string, unknown> };
    openapi: string;
    paths: Record<
      string,
      Record<string, { operationId?: string; requestBody?: unknown; security?: unknown }>
    >;
  };
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.paths["/api/v1/agents"].post.operationId, "createAgent");
  assert.equal(spec.paths["/api/v1/agents/{id}"].patch.operationId, "updateAgent");
  assert.equal(spec.paths["/api/v1/agents/{id}"].delete.operationId, "archiveAgent");
  assert.equal(spec.paths["/api/v1/calls"].get.operationId, "listCalls");
  assert.equal(spec.paths["/api/v1/calls/{id}"].get.operationId, "getCall");
  assert.equal(spec.paths["/api/v1/knowledge"].post.operationId, "createKnowledgeSource");
  assert.equal(spec.paths["/api/v1/evals/{id}"].get.operationId, "getEvalRun");

  const { $schema: _dialect, ...generatedCreateAgent } = z.toJSONSchema(createAgentSchema, {
    io: "input",
    reused: "inline",
  });
  assert.deepEqual(spec.components.schemas.CreateAgent, generatedCreateAgent);
  assert.deepEqual(spec.paths["/api/v1/agents"].post.requestBody, {
    content: { "application/json": { schema: { $ref: "#/components/schemas/CreateAgent" } } },
    required: true,
  });

  const references: string[] = [];
  const collectReferences = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectReferences(item);
      }
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "$ref" && typeof item === "string") {
          references.push(item);
        } else {
          collectReferences(item);
        }
      }
    }
  };
  collectReferences(spec.paths);
  for (const reference of references) {
    const [, schemaName] = schemaRefPattern.exec(reference) ?? [];
    assert.ok(
      schemaName && schemaName in spec.components.schemas,
      `Unresolved reference ${reference}`
    );
  }
  assert.equal(spec.paths["/api/v1/agents/templates"].get.operationId, "listAgentTemplates");
  assert.deepEqual(spec.paths["/api/v1/calls"].get.security, [
    { sessionCookie: [] },
    { bearerAuth: [] },
  ]);
});
