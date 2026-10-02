import base from "./rare-causal-cohort-v2.vitest";
export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/ltbye-intermediate-audit.test.ts"],
    },
};
