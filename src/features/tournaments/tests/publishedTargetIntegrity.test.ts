import { test } from "vitest";
import { verifyPublishedTargetIntegrity } from "../../../../scripts/check-published-target-integrity.mjs";

test("published target assignments require unique valid identities and rows", () => {
  verifyPublishedTargetIntegrity();
});
