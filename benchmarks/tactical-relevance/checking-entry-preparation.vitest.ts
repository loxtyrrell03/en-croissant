import base from "../../vite.config";
export default {
    ...base,
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/checking-entry-preparation-adjudication.test.ts"],
    },
};
