import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptProviderCredential, encryptProviderCredential } from "./provider-credentials.ts";

const KEY = "a1".repeat(32);
const ENVELOPE_PATTERN = /^v1\./;

test("provider credentials encrypt and decrypt with the deployment key", () => {
  const encrypted = encryptProviderCredential("provider-secret", KEY);

  assert.match(encrypted, ENVELOPE_PATTERN);
  assert.notEqual(encrypted, "provider-secret");
  assert.equal(decryptProviderCredential(encrypted, KEY), "provider-secret");
});

test("provider credentials decrypt values written by the Python runtime", () => {
  const envelope = "v1.VZAp8wKSP0Hn_g3vjADMZf9tMBm-WBQ_npDT7oFewMZp0TlWWaMjRreJb1vM2z4CmQ";

  assert.equal(decryptProviderCredential(envelope, KEY), "cross-language-secret");
});

test("provider credential encryption rejects malformed keys and tampering", () => {
  assert.throws(() => encryptProviderCredential("provider-secret", "short"));
  const encrypted = encryptProviderCredential("provider-secret", KEY);

  assert.throws(() => decryptProviderCredential(encrypted, "b2".repeat(32)));
  assert.throws(() => decryptProviderCredential("v2.invalid", KEY));
});
