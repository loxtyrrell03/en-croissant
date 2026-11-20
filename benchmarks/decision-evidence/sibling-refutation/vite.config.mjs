import baseline from "../settled-exchange-plans/vite.config.mjs";

export default {
  ...baseline,
  test: {
    environment: "node",
    include: [
      process.env.SIBLING_LIVE_ENGINE
        ? "benchmarks/decision-evidence/sibling-refutation/live.bench.ts"
        : "benchmarks/decision-evidence/sibling-refutation/replay.bench.ts",
    ],
  },
};
