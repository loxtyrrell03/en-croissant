export type CoachProvider = "openai" | "gemini";

export type CoachReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type CoachModelId =
    | "gpt-5.6-sol"
    | "gpt-5.6-terra"
    | "gpt-5.6-luna"
    | "gemini-3.1-pro"
    | "gemini-3.5-flash"
    | "gemini-3.6-flash";

export type CoachModelDefinition = {
    id: CoachModelId;
    label: string;
    provider: CoachProvider;
    providerLabel: string;
    command: "codex" | "agy";
    reasoningEfforts: readonly CoachReasoningEffort[];
    defaultReasoningEffort: CoachReasoningEffort;
};

const OPENAI_REASONING = ["low", "medium", "high", "xhigh", "max"] as const;
const GEMINI_FLASH_REASONING = ["low", "medium", "high"] as const;

export const COACH_MODELS: readonly CoachModelDefinition[] = [
    {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        provider: "openai",
        providerLabel: "OpenAI via Codex",
        command: "codex",
        reasoningEfforts: OPENAI_REASONING,
        defaultReasoningEffort: "medium",
    },
    {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        provider: "openai",
        providerLabel: "OpenAI via Codex",
        command: "codex",
        reasoningEfforts: OPENAI_REASONING,
        defaultReasoningEffort: "medium",
    },
    {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        provider: "openai",
        providerLabel: "OpenAI via Codex",
        command: "codex",
        reasoningEfforts: OPENAI_REASONING,
        defaultReasoningEffort: "medium",
    },
    {
        id: "gemini-3.1-pro",
        label: "Gemini 3.1 Pro",
        provider: "gemini",
        providerLabel: "Google via Antigravity",
        command: "agy",
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "high",
    },
    {
        id: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        provider: "gemini",
        providerLabel: "Google via Antigravity",
        command: "agy",
        reasoningEfforts: GEMINI_FLASH_REASONING,
        defaultReasoningEffort: "medium",
    },
    {
        id: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
        provider: "gemini",
        providerLabel: "Google via Antigravity",
        command: "agy",
        reasoningEfforts: GEMINI_FLASH_REASONING,
        defaultReasoningEffort: "medium",
    },
] as const;

export const DEFAULT_COACH_MODEL: CoachModelId = "gpt-5.6-sol";
export const DEFAULT_COACH_REASONING_EFFORT: CoachReasoningEffort = "medium";
export const COACH_MODEL_STORAGE_KEY = "ai-coach-model-v1";
export const COACH_REASONING_STORAGE_KEY = "ai-coach-reasoning-v1";

export const COACH_MODEL_SELECT_DATA = [
    {
        group: "OpenAI via Codex",
        items: COACH_MODELS.filter((model) => model.provider === "openai").map((model) => ({
            value: model.id,
            label: model.label,
        })),
    },
    {
        group: "Google via Antigravity",
        items: COACH_MODELS.filter((model) => model.provider === "gemini").map((model) => ({
            value: model.id,
            label: model.label,
        })),
    },
];

export const COACH_REASONING_LABELS: Record<CoachReasoningEffort, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
};

export function getCoachModelDefinition(value: unknown): CoachModelDefinition {
    return (
        COACH_MODELS.find((model) => model.id === value) ??
        COACH_MODELS.find((model) => model.id === DEFAULT_COACH_MODEL)!
    );
}

export function normalizeCoachModelId(value: unknown): CoachModelId {
    return getCoachModelDefinition(value).id;
}

export function normalizeCoachReasoningEffort(
    model: CoachModelDefinition,
    value: unknown,
): CoachReasoningEffort {
    return model.reasoningEfforts.includes(value as CoachReasoningEffort)
        ? (value as CoachReasoningEffort)
        : model.defaultReasoningEffort;
}

export function getCoachReasoningSelectData(model: CoachModelDefinition) {
    return model.reasoningEfforts.map((effort) => ({
        value: effort,
        label: COACH_REASONING_LABELS[effort],
    }));
}

export function formatCoachModelSelection(modelId: string, reasoningEffort?: string | null) {
    const model = COACH_MODELS.find((candidate) => candidate.id === modelId);
    const modelLabel = model?.label ?? modelId;
    const effortLabel = reasoningEffort
        ? (COACH_REASONING_LABELS[reasoningEffort as CoachReasoningEffort] ?? reasoningEffort)
        : "";
    return effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;
}
