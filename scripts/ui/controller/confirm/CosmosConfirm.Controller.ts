import {createStore, useStore} from "../store/CosmosStore.Controller";

export interface ConfirmRequest {
    title: string;
    message: string;
    confirmLabel?: string;
    /** Makes the button red. Use it for anything that deletes. */
    danger?: boolean;
    /** The user has to type this text before the button works. Used for whole databases and APIs. */
    typeToConfirm?: string;
}

interface ConfirmState {
    request: ConfirmRequest | null;
}

const confirmStore = createStore<ConfirmState>({request: null});
let pending: ((answer: boolean) => void) | null = null;

export const useConfirm = () => useStore(confirmStore);

/**
 * Asks before something is deleted. Every delete in the app goes through here, so nothing is lost by
 * one stray click. Resolves true only when the user confirms.
 */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
    pending?.(false); // a second question cancels the first
    return new Promise((resolve) => {
        pending = resolve;
        confirmStore.set({request});
    });
}

export function answerConfirm(answer: boolean): void {
    const resolve = pending;
    pending = null;
    confirmStore.set((state) => ({...state, request: null}));
    resolve?.(answer);
}
