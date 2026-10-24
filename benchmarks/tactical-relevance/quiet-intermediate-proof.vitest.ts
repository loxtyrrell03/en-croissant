import base from "./rare-causal-cohort-v2.vitest";
export default { ...base, test: { ...base.test,
    include: ["benchmarks/tactical-relevance/quiet-intermediate-proof.test.ts"] } };
