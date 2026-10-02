import base from "../../vite.config";

export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/dvs4f-zugzwang-proof.test.ts"],
    },
};
