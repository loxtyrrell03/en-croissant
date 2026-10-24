import base from "../../vite.config";
export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/endgame-composition-history.test.ts"],
        testTimeout: 15000,
    },
};
