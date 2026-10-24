import frozen from "./rare-mechanism-precision-v1.vitest";

// Reuse the exact-revision in-memory loader. No checkout, corpus or engine is
// needed for these two already-retained public development positions.
export default { ...frozen, test: { ...frozen.test,
    include: ["benchmarks/tactical-relevance/quiet-clearance-boundary.test.ts"] } };
