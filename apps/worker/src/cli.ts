import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb, evalResults, evalRuns } from "@answerline/db";
import { evalExecutionInputSchema, parseAgentConfig, parseEvalSuite } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createEvalRun, findDefaultTenantAgent, processEvalRun } from "./evals.ts";
import {
  addPhoneNumber,
  assignPhoneNumber,
  connectPhoneNumber,
  createPhoneNumberClient,
  listPhoneNumbers,
  type PhoneNumber,
  phoneNumberSchema,
  removePhoneNumber,
  sipEnvSchema,
} from "./phone-numbers.ts";
import { setupTelnyxConnection, telnyxEnvSchema } from "./telnyx.ts";
import { setupTwilioTrunk, twilioEnvSchema } from "./twilio.ts";

const SIP_USAGE = `usage:
  worker sip list
  worker sip add <+15551234567> <agent> [--allowed-address <ip-or-cidr>]... [--auth-username <user> --auth-password <pass>]
  worker sip assign <+15551234567> <agent>
  worker sip remove <+15551234567>
  worker sip twilio <+15551234567> <agent> [--sip-host <host>]   (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN; host defaults to SIP_PUBLIC_IP)
  worker sip telnyx <+15551234567> <agent> --sip-host <hostname>   (TELNYX_API_KEY)`;

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function runEval(args: string[]) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: {
      audio: { type: "boolean" },
      "live-tools": { type: "boolean" },
      model: { type: "string" },
    },
  });
  const [agentPath, ...extra] = positionals;
  if (!agentPath || extra.length) {
    throw new Error(
      "usage: worker eval <agents/name.yaml> [--model provider/model] [--live-tools] [--audio]"
    );
  }

  const resolvedAgentPath = resolve(repositoryRoot, agentPath);
  const agent = parseAgentConfig(await readFile(resolvedAgentPath, "utf8"));
  const agentSlug = basename(resolvedAgentPath, extname(resolvedAgentPath));
  const suiteFile = join(dirname(resolvedAgentPath), "..", "evals", basename(resolvedAgentPath));
  const suite = parseEvalSuite(await readFile(suiteFile, "utf8"));
  const db = createDb();

  try {
    const agentRow = await findDefaultTenantAgent(db, agentSlug);
    if (!agentRow) {
      throw new Error(`agent ${agentSlug} was not found in the default tenant; run pnpm db:seed`);
    }
    const executionInput = evalExecutionInputSchema.parse({
      agent,
      context: { agentSlug: agentRow.agentSlug, tenantSlug: agentRow.tenantSlug },
      liveTools: values["live-tools"],
      mode: values.audio ? "audio" : "text",
      modelOverride: values.model,
      suite,
    });
    const suiteName = basename(suiteFile, extname(suiteFile));
    const runId = await createEvalRun(db, {
      agentId: agentRow.agentId,
      executionInput,
      suite: suiteName,
      tenantId: agentRow.tenantId,
    });
    await processEvalRun(db, {
      agentId: agentRow.agentId,
      runId,
      tenantId: agentRow.tenantId,
    });

    const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
    const results = await db.select().from(evalResults).where(eq(evalResults.runId, runId));
    if (run?.status !== "completed") {
      throw new Error(run?.error ?? "eval run did not complete");
    }

    const rate = run.total ? Math.round(((run.passed ?? 0) / run.total) * 100) : 0;
    console.log(`eval run: ${runId}`);
    console.log(`${agent.name}: ${run.passed}/${run.total} passed (${rate}%)`);
    console.log(`average latency: ${run.avgLatencyMs === null ? "n/a" : `${run.avgLatencyMs} ms`}`);
    console.log(`cost: ${run.costUsd === null ? "n/a" : `$${run.costUsd}`}`);
    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.caseName}`);
      for (const failure of result.failures) {
        console.log(`  ${failure}`);
      }
    }
    if (run.passed !== run.total) {
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

function printNumber(n: PhoneNumber) {
  console.log(
    `${n.number}\tagent=${n.agent ?? "-"}\ttrunk=${n.trunkId}\trule=${n.dispatchRuleId ?? "-"}`
  );
}

async function runSip(args: string[]) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: {
      "allowed-address": { multiple: true, type: "string" },
      "auth-password": { type: "string" },
      "auth-username": { type: "string" },
      "sip-host": { type: "string" },
    },
  });
  const [action, number, agent] = positionals;
  const env = sipEnvSchema.parse(process.env);
  const client = createPhoneNumberClient(env);

  if (action === "list") {
    const numbers = await listPhoneNumbers(client);
    if (numbers.length === 0) {
      console.log("no phone numbers connected");
    }
    numbers.forEach(printNumber);
  } else if (action === "add" && number && agent) {
    printNumber(
      await addPhoneNumber(client, env.AGENT_NAME, {
        agent,
        allowedAddresses: values["allowed-address"],
        authPassword: values["auth-password"],
        authUsername: values["auth-username"],
        number,
      })
    );
  } else if (action === "assign" && number && agent) {
    printNumber(await assignPhoneNumber(client, env.AGENT_NAME, number, agent));
  } else if (action === "twilio" && number && agent) {
    const sipHost = values["sip-host"] ?? process.env.SIP_PUBLIC_IP;
    if (!sipHost) {
      fail("--sip-host (or SIP_PUBLIC_IP) is required: the public host or IP of your SIP service");
    }
    const twilio = twilioEnvSchema.parse(process.env);
    const trunk = await setupTwilioTrunk({
      accountSid: twilio.TWILIO_ACCOUNT_SID,
      authToken: twilio.TWILIO_AUTH_TOKEN,
      number: phoneNumberSchema.parse(number),
      sipHost,
    });
    console.log(`twilio trunk ${trunk.trunkSid} -> ${trunk.originationUrl}, transfers enabled`);
    printNumber(await connectPhoneNumber(client, env.AGENT_NAME, { agent, number }));
  } else if (action === "telnyx" && number && agent) {
    const sipHost = values["sip-host"] ?? process.env.SIP_PUBLIC_IP;
    if (!sipHost) {
      fail("--sip-host is required: the public hostname of your SIP service");
    }
    const telnyx = telnyxEnvSchema.parse(process.env);
    const result = await setupTelnyxConnection({
      apiKey: telnyx.TELNYX_API_KEY,
      number: phoneNumberSchema.parse(number),
      sipHost,
    });
    console.log(`telnyx connection ${result.connectionId} -> sip:${sipHost}:5060 (TCP)`);
    printNumber(await connectPhoneNumber(client, env.AGENT_NAME, { agent, number }));
  } else if (action === "remove" && number) {
    await removePhoneNumber(client, number);
    console.log(`removed ${number}`);
  } else {
    fail(SIP_USAGE);
  }
}

const [command, ...rest] = process.argv.slice(2);

if (command === "eval") {
  await runEval(rest).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
} else if (command === "sip") {
  await runSip(rest).catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      fail(z.prettifyError(error));
    }
    fail(error instanceof Error ? error.message : String(error));
  });
} else {
  fail(`usage: worker eval <agents/name.yaml>\n${SIP_USAGE}`);
}
