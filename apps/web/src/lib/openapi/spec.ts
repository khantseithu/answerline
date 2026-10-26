import {
  agentIdSchema,
  agentTemplateSchema,
  agentVersionViewSchema,
  agentViewSchema,
  callsListQuerySchema,
  costLineSchema,
  createAgentSchema,
  evalRunCreateSchema,
  outboundCallRequestSchema,
  outboundCallResponseSchema,
  updateAgentSchema,
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  webhookEventSchema,
} from "@answerline/shared";
import { z } from "zod";
import { evalRunList, evalRunView } from "@/lib/evals/types";
import { createKnowledgeSource, knowledgeSourceId } from "@/lib/knowledge/schemas";
import { knowledgeSourceList } from "@/lib/knowledge/types";

const callItem = z.object({
  agentName: z.string(),
  caller: z.string().nullable(),
  channel: z.enum(["web", "sip"]),
  costUsd: z.string().nullable(),
  durationMs: z.number().nullable(),
  id: z.uuid(),
  outcome: z.string().nullable(),
  startedAt: z.iso.datetime(),
  status: z.enum(["in_progress", "completed", "failed"]),
});
const callsListResponse = z.object({
  items: z.array(callItem),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
const callDetailResponse = z.object({
  agentName: z.string(),
  channel: z.enum(["web", "sip"]),
  costBreakdown: z.array(costLineSchema).nullable(),
  costUsd: z.string().nullable(),
  direction: z.string(),
  durationMs: z.number().nullable(),
  endedAt: z.iso.datetime().nullable(),
  fromNumber: z.string().nullable(),
  hasRecording: z.boolean(),
  id: z.uuid(),
  outcome: z.string().nullable(),
  recordingStartedAt: z.iso.datetime().nullable(),
  sentiment: z.string().nullable(),
  startedAt: z.iso.datetime(),
  status: z.enum(["in_progress", "completed", "failed"]),
  summary: z.string().nullable(),
  toNumber: z.string().nullable(),
  toolCalls: z.array(
    z.object({
      args: z.unknown(),
      createdAt: z.iso.datetime(),
      error: z.string().nullable(),
      id: z.uuid(),
      latencyMs: z.number().nullable(),
      name: z.string(),
      result: z.unknown().nullable(),
      seq: z.number().int(),
      status: z.string(),
    })
  ),
  turns: z.array(
    z.object({
      endedAt: z.iso.datetime().nullable(),
      id: z.uuid(),
      interrupted: z.boolean(),
      latency: z.number().nullable(),
      role: z.string(),
      seq: z.number().int(),
      startedAt: z.iso.datetime().nullable(),
      text: z.string(),
    })
  ),
});
const evalResult = z.object({
  caseName: z.string(),
  costUsd: z.string().nullable(),
  failures: z.array(z.string()),
  id: z.uuid(),
  latencyMs: z.number().nullable(),
  passed: z.boolean(),
  transcript: z.array(z.object({ role: z.enum(["caller", "agent"]), text: z.string() })),
});
const evalRunDetail = z.object({ results: z.array(evalResult), run: evalRunView });
const errorResponse = z.object({ error: z.string() });
const idResponse = z.object({ id: z.uuid() });
const evalRunCreateResponse = z.object({ run: evalRunView });
const webhookEndpoint = z.object({
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  enabled: z.boolean(),
  events: z.array(z.string()),
  id: z.uuid(),
  name: z.string(),
  updatedAt: z.iso.datetime(),
  url: z.url(),
});
const webhookDelivery = z.object({
  attemptCount: z.number().int(),
  createdAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  eventId: z.string(),
  eventType: z.string(),
  id: z.uuid(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  payload: webhookEventSchema,
  replayCount: z.number().int(),
  responseBody: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  status: z.enum(["pending", "delivered", "failed"]),
});

const schemas = {
  Agent: agentViewSchema,
  AgentList: agentViewSchema.array(),
  AgentTemplate: agentTemplateSchema,
  AgentTemplateList: agentTemplateSchema.array(),
  AgentVersion: agentVersionViewSchema,
  AgentVersionList: agentVersionViewSchema.array(),
  CallDetail: callDetailResponse,
  CallList: callsListResponse,
  CreateAgent: createAgentSchema,
  CreateEvalRun: evalRunCreateSchema,
  CreateKnowledgeSource: createKnowledgeSource,
  CreateOutboundCall: outboundCallRequestSchema,
  CreateWebhookEndpoint: webhookEndpointCreateSchema,
  Error: errorResponse,
  EvalRun: evalRunView,
  EvalRunCreateResponse: evalRunCreateResponse,
  EvalRunDetail: evalRunDetail,
  EvalRunList: evalRunList,
  Id: idResponse,
  KnowledgeSourceList: knowledgeSourceList,
  OutboundCallCreateResponse: outboundCallResponseSchema,
  UpdateAgent: updateAgentSchema,
  UpdateWebhookEndpoint: webhookEndpointUpdateSchema,
  WebhookDeliveryList: z.object({ deliveries: webhookDelivery.array() }),
  WebhookEndpoint: webhookEndpoint,
  WebhookEndpointCreated: webhookEndpoint.extend({ secret: z.string() }),
  WebhookEndpointList: z.object({ endpoints: webhookEndpoint.array() }),
  WebhookReplay: z.object({
    deliveryId: z.uuid(),
    replayCount: z.number().int(),
    status: z.literal("pending"),
  }),
};

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _jsonSchemaDialect, ...result } = z.toJSONSchema(schema, {
    io: "input",
    reused: "inline",
  });
  return result;
};

const components = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, jsonSchema(schema)])
);

const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
const jsonResponse = (description: string, schema: keyof typeof schemas) => ({
  content: { "application/json": { schema: ref(schema) } },
  description,
});
const requestBody = (schema: keyof typeof schemas) => ({
  content: { "application/json": { schema: ref(schema) } },
  required: true,
});
const idParameter = (name = "id", schema: z.ZodType = agentIdSchema) => ({
  in: "path",
  name,
  required: true,
  schema: jsonSchema(schema),
});
const workspaceSecurity = [{ sessionCookie: [] }, { bearerAuth: [] }];
const commonErrors = {
  "400": jsonResponse("The request is invalid.", "Error"),
  "401": jsonResponse("A valid workspace session or API key is required.", "Error"),
  "403": jsonResponse("The workspace role does not allow this operation.", "Error"),
};

const paths = {
  "/api/v1/agents": {
    get: {
      operationId: "listAgents",
      responses: { "200": jsonResponse("Workspace agents.", "AgentList"), ...commonErrors },
      security: workspaceSecurity,
      summary: "List agents",
      tags: ["Agents"],
    },
    post: {
      operationId: "createAgent",
      requestBody: requestBody("CreateAgent"),
      responses: {
        "201": jsonResponse("The created agent.", "Agent"),
        "400": commonErrors["400"],
        "401": commonErrors["401"],
        "403": commonErrors["403"],
        "409": jsonResponse("An agent with this slug already exists.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Create an agent",
      tags: ["Agents"],
    },
  },
  "/api/v1/agents/{id}": {
    delete: {
      operationId: "archiveAgent",
      parameters: [idParameter()],
      responses: {
        "204": { description: "The agent was archived; call and knowledge history is preserved." },
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Archive an agent",
      tags: ["Agents"],
    },
    get: {
      operationId: "getAgent",
      parameters: [idParameter()],
      responses: {
        "200": jsonResponse("The requested agent.", "Agent"),
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Get an agent",
      tags: ["Agents"],
    },
    patch: {
      operationId: "updateAgent",
      parameters: [idParameter()],
      requestBody: requestBody("UpdateAgent"),
      responses: {
        "200": jsonResponse("The updated agent.", "Agent"),
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Update an agent",
      tags: ["Agents"],
    },
  },
  "/api/v1/agents/{id}/versions": {
    get: {
      operationId: "listAgentVersions",
      parameters: [idParameter()],
      responses: {
        "200": jsonResponse("Agent versions.", "AgentVersionList"),
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "List agent versions",
      tags: ["Agents"],
    },
  },
  "/api/v1/agents/templates": {
    get: {
      operationId: "listAgentTemplates",
      responses: {
        "200": jsonResponse("Available agent templates.", "AgentTemplateList"),
        ...commonErrors,
      },
      security: workspaceSecurity,
      summary: "List agent templates",
      tags: ["Agents"],
    },
  },
  "/api/v1/calls": {
    get: {
      operationId: "listCalls",
      parameters: Object.entries(jsonSchema(callsListQuerySchema).properties ?? {}).map(
        ([name, schema]) => ({ in: "query", name, required: false, schema })
      ),
      responses: { "200": jsonResponse("A page of calls.", "CallList"), ...commonErrors },
      security: workspaceSecurity,
      summary: "List calls",
      tags: ["Calls"],
    },
    post: {
      operationId: "startOutboundCall",
      requestBody: requestBody("CreateOutboundCall"),
      responses: {
        "202": jsonResponse("The outbound call was initiated.", "OutboundCallCreateResponse"),
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
        "502": jsonResponse("The outbound call could not be started.", "Error"),
        "503": jsonResponse("Outbound calling is not configured.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Start an outbound call",
      tags: ["Calls"],
    },
  },
  "/api/v1/calls/{id}": {
    get: {
      operationId: "getCall",
      parameters: [idParameter("id", z.uuid())],
      responses: {
        "200": jsonResponse("The call, transcript turns, and tool calls.", "CallDetail"),
        ...commonErrors,
        "404": jsonResponse("Call not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Get a call",
      tags: ["Calls"],
    },
  },
  "/api/v1/evals": {
    get: {
      operationId: "listEvalRuns",
      responses: {
        "200": jsonResponse("Workspace evaluation runs.", "EvalRunList"),
        ...commonErrors,
      },
      security: workspaceSecurity,
      summary: "List evaluation runs",
      tags: ["Evaluations"],
    },
    post: {
      operationId: "createEvalRun",
      requestBody: requestBody("CreateEvalRun"),
      responses: {
        "202": jsonResponse("The queued evaluation run.", "EvalRunCreateResponse"),
        ...commonErrors,
        "404": jsonResponse("Agent not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Start an evaluation run",
      tags: ["Evaluations"],
    },
  },
  "/api/v1/evals/{id}": {
    get: {
      operationId: "getEvalRun",
      parameters: [idParameter("id")],
      responses: {
        "200": jsonResponse("Evaluation run and case results.", "EvalRunDetail"),
        ...commonErrors,
        "404": jsonResponse("Evaluation run not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Get an evaluation run",
      tags: ["Evaluations"],
    },
  },
  "/api/v1/knowledge": {
    get: {
      operationId: "listKnowledgeSources",
      responses: {
        "200": jsonResponse("Workspace knowledge sources.", "KnowledgeSourceList"),
        ...commonErrors,
      },
      security: workspaceSecurity,
      summary: "List knowledge sources",
      tags: ["Knowledge"],
    },
    post: {
      operationId: "createKnowledgeSource",
      requestBody: requestBody("CreateKnowledgeSource"),
      responses: {
        "201": jsonResponse("The created source identifier.", "Id"),
        ...commonErrors,
      },
      security: workspaceSecurity,
      summary: "Create a knowledge source",
      tags: ["Knowledge"],
    },
  },
  "/api/v1/knowledge/{id}": {
    delete: {
      operationId: "deleteKnowledgeSource",
      parameters: [idParameter("id", knowledgeSourceId)],
      responses: {
        "204": { description: "The source was deleted." },
        ...commonErrors,
        "404": jsonResponse("Knowledge source not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Delete a knowledge source",
      tags: ["Knowledge"],
    },
  },
  "/api/v1/knowledge/{id}/sync": {
    post: {
      operationId: "syncKnowledgeSource",
      parameters: [idParameter("id", knowledgeSourceId)],
      responses: {
        "202": jsonResponse("The queued source identifier.", "Id"),
        ...commonErrors,
        "404": jsonResponse("Knowledge source not found.", "Error"),
      },
      security: workspaceSecurity,
      summary: "Sync a knowledge source",
      tags: ["Knowledge"],
    },
  },
  "/api/v1/webhooks": {
    get: {
      operationId: "listWebhookEndpoints",
      responses: {
        "200": jsonResponse("Workspace webhook endpoints.", "WebhookEndpointList"),
        ...commonErrors,
      },
      security: [{ sessionCookie: [] }],
      summary: "List webhook endpoints",
      tags: ["Webhooks"],
    },
    post: {
      operationId: "createWebhookEndpoint",
      requestBody: requestBody("CreateWebhookEndpoint"),
      responses: {
        "201": jsonResponse(
          "The endpoint and its secret, which is shown only once.",
          "WebhookEndpointCreated"
        ),
        ...commonErrors,
        "503": jsonResponse("Webhook secret encryption is not configured.", "Error"),
      },
      security: [{ sessionCookie: [] }],
      summary: "Create a webhook endpoint",
      tags: ["Webhooks"],
    },
  },
  "/api/v1/webhooks/{id}": {
    delete: {
      operationId: "deleteWebhookEndpoint",
      parameters: [idParameter()],
      responses: { "200": jsonResponse("The endpoint was archived.", "Id"), ...commonErrors },
      security: [{ sessionCookie: [] }],
      summary: "Archive a webhook endpoint",
      tags: ["Webhooks"],
    },
    get: {
      operationId: "getWebhookEndpoint",
      parameters: [idParameter()],
      responses: {
        "200": jsonResponse("The requested endpoint.", "WebhookEndpoint"),
        ...commonErrors,
      },
      security: [{ sessionCookie: [] }],
      summary: "Get a webhook endpoint",
      tags: ["Webhooks"],
    },
    patch: {
      operationId: "updateWebhookEndpoint",
      parameters: [idParameter()],
      requestBody: requestBody("UpdateWebhookEndpoint"),
      responses: {
        "200": jsonResponse("The updated endpoint.", "WebhookEndpoint"),
        ...commonErrors,
      },
      security: [{ sessionCookie: [] }],
      summary: "Update a webhook endpoint",
      tags: ["Webhooks"],
    },
  },
  "/api/v1/webhooks/{id}/deliveries": {
    get: {
      operationId: "listWebhookDeliveries",
      parameters: [
        idParameter(),
        { in: "query", name: "limit", schema: { maximum: 100, minimum: 1, type: "integer" } },
        { in: "query", name: "offset", schema: { minimum: 0, type: "integer" } },
      ],
      responses: {
        "200": jsonResponse("Delivery history for the endpoint.", "WebhookDeliveryList"),
        ...commonErrors,
      },
      security: [{ sessionCookie: [] }],
      summary: "List webhook deliveries",
      tags: ["Webhooks"],
    },
  },
  "/api/v1/webhooks/{id}/deliveries/{deliveryId}/replay": {
    post: {
      operationId: "replayWebhookDelivery",
      parameters: [idParameter(), idParameter("deliveryId", z.uuid())],
      responses: {
        "202": jsonResponse("The delivery was queued for replay.", "WebhookReplay"),
        ...commonErrors,
        "409": jsonResponse("The delivery is already pending.", "Error"),
      },
      security: [{ sessionCookie: [] }],
      summary: "Replay a webhook delivery",
      tags: ["Webhooks"],
    },
  },
} as const;

export const openApiSpec = {
  components: {
    schemas: components,
    securitySchemes: {
      bearerAuth: {
        description:
          "Workspace API key. Include it as `Authorization: Bearer <key>` with the scope required by the operation.",
        scheme: "bearer",
        type: "http",
      },
      sessionCookie: {
        description:
          "Better Auth session cookie. Secure deployments may prefix its name with __Secure-.",
        in: "cookie",
        name: "better-auth.session_token",
        type: "apiKey",
      },
    },
  },
  info: {
    description:
      "Workspace operations accept a signed-in session or a scoped workspace API key. Session writes require an admin or owner; API key operations require the matching key scope.",
    title: "Answerline API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths,
};
