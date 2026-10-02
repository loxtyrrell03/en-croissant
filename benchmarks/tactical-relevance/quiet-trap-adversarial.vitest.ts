import base from "../../vite.config";
export default { ...base, test: { ...base.test, include: ["benchmarks/tactical-relevance/quiet-trap-adversarial.test.ts"] } };
