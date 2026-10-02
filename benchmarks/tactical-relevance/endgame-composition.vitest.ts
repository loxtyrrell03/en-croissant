import base from "../../vite.config";
export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/endgame-composition-prototype.test.ts"],
        testTimeout: 15000,
    },
};
