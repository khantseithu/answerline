import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
const skip = docker.status === 0 ? false : "Docker Compose not available";
const environment = {
  ...process.env,
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "compose-test-admin-password",
  ANSWERLINE_ENV_FILE: ".env.production.example",
  APP_DOMAIN: "answerline.example.com",
  BETTER_AUTH_SECRET: "compose-test-auth-secret-at-least-32-characters",
  LIVEKIT_API_KEY: "compose-test-key",
  LIVEKIT_API_SECRET: "compose-test-api-secret-at-least-32-characters",
  LIVEKIT_DOMAIN: "livekit.example.com",
  POSTGRES_PASSWORD: "compose-test-postgres-password",
  S3_ACCESS_KEY: "compose-test-access-key",
  S3_BUCKET: "recordings",
  S3_EGRESS_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_SECRET_KEY: "compose-test-secret-key",
  SIP_PUBLIC_IP: "192.0.2.1",
  TURN_DOMAIN: "turn.example.com",
};

function render(env) {
  return spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.production.example",
      "-f",
      "docker-compose.production.yml",
      "config",
      "--format",
      "json",
    ],
    { cwd: root, encoding: "utf8", env }
  );
}

test("production deployment rejects missing required secrets before creating services", {
  skip,
}, () => {
  const result = render({ ...environment, POSTGRES_PASSWORD: "" });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Set POSTGRES_PASSWORD"));
});

test("custom RTC and SIP ports remain identical inside and outside containers", { skip }, () => {
  const result = render({
    ...environment,
    LIVEKIT_RTC_PORT_END: "51010",
    LIVEKIT_RTC_PORT_START: "51000",
    LIVEKIT_TCP_PORT: "37881",
    LIVEKIT_TURN_UDP_PORT: "33478",
    SIP_PORT: "35060",
    SIP_RTP_PORT_END: "52010",
    SIP_RTP_PORT_START: "52000",
  });
  assert.equal(result.status, 0, result.stderr);
  const { services } = JSON.parse(result.stdout);
  for (const service of [services.livekit, services.sip]) {
    for (const port of service.ports) {
      assert.equal(String(port.target), port.published);
    }
  }
  const config = services.livekit.environment.LIVEKIT_CONFIG;
  assert.ok(config.includes("tcp_port: 37881"));
  assert.ok(config.includes("port_range_start: 51000"));
  assert.ok(config.includes("port_range_end: 51010"));
  assert.ok(config.includes("udp_port: 33478"));
  const sipConfig = services.sip.environment.SIP_CONFIG_BODY;
  assert.ok(sipConfig.includes("sip_port: 35060"));
  assert.ok(sipConfig.includes("rtp_port: 52000-52010"));
});
