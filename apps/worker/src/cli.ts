import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseAgentConfig, parseEvalSuite } from "@answerline/shared";
import { z } from "zod";
import {
  addPhoneNumber,
  assignPhoneNumber,
  createPhoneNumberClient,
  listPhoneNumbers,
  type PhoneNumber,
  removePhoneNumber,
  sipEnvSchema,
} from "./phone-numbers.ts";

const SIP_USAGE = `usage:
  worker sip list
  worker sip add <+15551234567> <agent> [--allowed-address <ip-or-cidr>]... [--auth-username <user> --auth-password <pass>]
  worker sip assign <+15551234567> <agent>
  worker sip remove <+15551234567>`;

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
