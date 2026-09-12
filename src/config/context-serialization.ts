export const CONTEXT_SERIALIZATION_MODES = ["default", "lean"] as const;

export type ContextSerialization = (typeof CONTEXT_SERIALIZATION_MODES)[number];
