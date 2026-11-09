/** Remembers when things last ran, so a repeat within a short time can be ignored. */
export class Cooldown {
    private readonly lastRun = new Map<string, number>();

    /** True if `key` ran less than `ms` ago. Otherwise records it as running now. */
    tooSoon(key: string, ms: number): boolean {
        const now = Date.now();
        if (now - (this.lastRun.get(key) ?? 0) < ms) {
            return true;
        }

        this.lastRun.set(key, now);
        return false;
    }
}
