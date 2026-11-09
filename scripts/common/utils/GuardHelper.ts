/** Checks values that came from a file or from the page, where TypeScript can't promise anything. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
    return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function toNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, value));
}

export function toText(value: unknown, fallback: string, maxLength = 2000): string {
    if (typeof value !== "string") {
        return fallback;
    }
    return value.slice(0, maxLength);
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** Rounds to a few decimals, so saved files don't fill up with 0.30000000000000004. */
export function round(value: number, decimals = 3): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
