import { resolve } from "node:path";

export default {
  resolve: { alias: { "@": resolve("src") } },
  test: {
    include: ["benchmarks/decision-evidence/exact-endgame-decisions/challenge.test.ts"],
    environment: "node",
  },
};
