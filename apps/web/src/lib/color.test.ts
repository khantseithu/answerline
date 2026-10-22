import assert from "node:assert/strict";
import { test } from "node:test";
import { labToOklch } from "./color";

const ALPHA_OKLCH = /^oklch\([\d.]+ 0 0 \/ 50%\)$/;

test("converts the compiled lab() fallback back to the authored oklch() token", () => {
  assert.equal(labToOklch("lab(98.6457% -1.01596 -.00975132)"), "oklch(0.988 0.003 180)");
  assert.equal(labToOklch("lab(43.2716% -35.348 1.0)").startsWith("oklch(0.5 0.1"), true);
});

test("keeps alpha and leaves other formats untouched", () => {
  assert.match(labToOklch("lab(50% 0 0 / 50%)"), ALPHA_OKLCH);
  assert.equal(labToOklch(" oklch(0.5 0.1 178) "), "oklch(0.5 0.1 178)");
  assert.equal(labToOklch("#007563"), "#007563");
});
