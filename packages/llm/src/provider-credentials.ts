import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

function encryptionKey(encodedKey: string) {
  if (!KEY_PATTERN.test(encodedKey)) {
    throw new Error("PROVIDER_KEYS_ENCRYPTION_KEY must be 64 hexadecimal characters");
  }
  return Buffer.from(encodedKey, "hex");
}

export function encryptProviderCredential(plaintext: string, encodedKey: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url")}`;
}

export function decryptProviderCredential(envelope: string, encodedKey: string) {
  const [version, payload] = envelope.split(".");
  if (version !== "v1" || !payload) {
    throw new Error("Unsupported provider credential envelope");
  }
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid provider credential envelope");
  }
  const iv = bytes.subarray(0, IV_LENGTH);
  const tag = bytes.subarray(-TAG_LENGTH);
  const ciphertext = bytes.subarray(IV_LENGTH, -TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(encodedKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
