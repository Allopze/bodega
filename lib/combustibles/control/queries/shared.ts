export const toNumber = (value: unknown): number => Number(value ?? 0)
export const toNullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
