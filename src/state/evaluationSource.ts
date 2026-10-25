import { atom } from "jotai";
import { getEvaluationSourceEpoch, subscribeEvaluationSource } from "@/utils/evaluationSource";
export const evaluationSourceEpochAtom = atom(getEvaluationSourceEpoch());
evaluationSourceEpochAtom.onMount = subscribeEvaluationSource;
