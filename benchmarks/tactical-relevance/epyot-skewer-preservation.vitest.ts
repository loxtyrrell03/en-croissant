import base from "./epyot-causal-audit.vitest";
export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/epyot-skewer-preservation.test.ts"],
    },
};
