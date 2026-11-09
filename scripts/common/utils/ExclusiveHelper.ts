/**
 * Wraps an async action so that calling it again while it is still running is ignored. This is what
 * stops a double click from starting the same thing twice.
 * Pass `key` to track each target separately (for example one per project).
 */
export function exclusive<Args extends unknown[]>(
    action: (...args: Args) => Promise<void>,
    key?: (...args: Args) => string
): (...args: Args) => Promise<void> {
    const running = new Set<string>();

    return async (...args: Args) => {
        const id = key ? key(...args) : "";
        if (running.has(id)) {
            return;
        }

        running.add(id);
        try {
            await action(...args);
        } finally {
            running.delete(id);
        }
    };
}
