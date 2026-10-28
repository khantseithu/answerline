import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  type EvalExecutionInput,
  type EvalExecutionOutput,
  evalExecutionInputSchema,
  evalExecutionOutputSchema,
} from "@answerline/shared";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const maxOutputChars = 10_000_000;
const timeoutMs = 10 * 60 * 1000;
const maxErrorDetailChars = 500;

export function describeRunnerFailure(code: number | null, stderr: string) {
  const base = `eval runner exited with status ${code ?? "unknown"}`;
  const detail = extractRunnerError(stderr);
  return detail ? `${base}: ${detail}` : base;
}

function extractRunnerError(stderr: string) {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return "";
  }
  const message = trimmed
    .split("\n")
    .reverse()
    .map(parseErrorLine)
    .find((candidate) => candidate);
  return message ? capDetail(message, "start") : capDetail(trimmed, "end");
}

function parseErrorLine(line: string) {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      return typeof parsed.error === "string" ? parsed.error.trim() : "";
    }
  } catch {
    return "";
  }
  return "";
}

function capDetail(text: string, keep: "start" | "end") {
  if (text.length <= maxErrorDetailChars) {
    return text;
  }
  return keep === "start"
    ? `${text.slice(0, maxErrorDetailChars)}...`
    : `...${text.slice(-maxErrorDetailChars)}`;
}

export function executeEval(input: EvalExecutionInput, providerKeys?: Record<string, string>) {
  const parsedInput = evalExecutionInputSchema.parse(input);
  return new Promise<EvalExecutionOutput>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "-m", "answerline_agent.eval_runner"], {
      cwd: repositoryRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exited = false;
    let killTimer: NodeJS.Timeout | undefined;

    function terminate(error: Error) {
      if (settled) {
        return;
      }
      if (child.pid !== undefined) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!exited) {
            child.kill("SIGKILL");
          }
        }, 5000);
        killTimer.unref();
      }
      finish(error);
    }

    const timer = setTimeout(() => {
      terminate(new Error("eval execution timed out"));
    }, timeoutMs);

    function finish(error?: Error, output?: EvalExecutionOutput) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else if (output) {
        resolve(output);
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) {
        return;
      }
      stdout += chunk;
      if (stdout.length > maxOutputChars) {
        terminate(new Error("eval runner output exceeded the size limit"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (settled) {
        return;
      }
      stderr += chunk;
      if (stderr.length > maxOutputChars) {
        terminate(new Error("eval runner error output exceeded the size limit"));
      }
    });
    child.on("error", () => terminate(new Error("could not start the eval runner")));
    child.on("close", (code) => {
      exited = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (settled) {
        return;
      }
      if (code !== 0) {
        finish(new Error(describeRunnerFailure(code, stderr)));
        return;
      }
      try {
        finish(undefined, evalExecutionOutputSchema.parse(JSON.parse(stdout)));
      } catch {
        finish(new Error("eval runner returned invalid output"));
      }
    });
    child.stdin.on("error", () => terminate(new Error("could not send input to the eval runner")));
    child.stdin.end(JSON.stringify({ input: parsedInput, providerKeys: providerKeys ?? {} }));
  });
}
