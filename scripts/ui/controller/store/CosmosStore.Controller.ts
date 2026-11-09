import {useSyncExternalStore} from "react";

/** A tiny observable value. Views read it with useStore(), controllers change it with set(). */
export interface Store<T> {
    get: () => T;
    set: (next: T | ((previous: T) => T)) => void;
    subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
    let value = initial;
    const listeners = new Set<() => void>();

    return {
        get: () => value,
        set(next) {
            const resolved = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
            if (Object.is(resolved, value)) {
                return;
            }

            value = resolved;
            listeners.forEach((listener) => listener());
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}

/** Re-renders the component whenever the store changes. Always replace values, never edit them in place. */
export function useStore<T>(store: Store<T>): T {
    return useSyncExternalStore(store.subscribe, store.get);
}

/** Like useStore, but only re-renders when the picked part changes. The pick must return the same value for the same data. */
export function useStoreSelector<T, R>(store: Store<T>, pick: (state: T) => R): R {
    return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}
