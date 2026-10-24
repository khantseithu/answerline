import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseAgentConfig, parseEvalSuite } from "@answerline/shared";
import { z } from "zod";
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function runEval(agentFile: string | undefined) {
  if (!agentFile) {
    fail("usage: worker eval <agents/name.yaml>");
  }
  const suiteFile = join(dirname(agentFile), "..", "evals", basename(agentFile));
  const agent = parseAgentConfig(await readFile(agentFile, "utf8"));
  const suite = parseEvalSuite(await readFile(suiteFile, "utf8"));

  console.log(`${agent.name}: ${suite.length} eval cases from ${suiteFile}`);
  for (const c of suite) {
    console.log(`- ${c.name}`);
  }
  fail("eval runner not implemented yet");
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
  await runEval(rest[0]);
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
