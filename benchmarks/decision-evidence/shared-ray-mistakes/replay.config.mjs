import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import archive from "../current-classifier-audit/replay.config.mjs";

const sequence = resolve("src/utils/tacticalMotifs/tacticalSequenceEvidence.ts").replaceAll("\\", "/");
const guard = {
  name: "shared-ray-exchange-candidate",
  enforce: "pre",
  load(id) {
    if (id.split("?")[0].replaceAll("\\", "/") === sequence) {
      return readFileSync(sequence, "utf8");
    }
    return null;
  },
};

export default {
  ...archive,
  plugins: process.env.RAY_EXCHANGE_GUARD ? [guard, ...archive.plugins] : archive.plugins,
};
