import {createStore, useStore} from "../store/CosmosStore.Controller";

interface ToastState {
    message: string;
    isError: boolean;
    visible: boolean;
}

const toastStore = createStore<ToastState>({message: "", isError: false, visible: false});
let hideTimer: number | undefined;

/** A short message at the bottom of the window. Errors stay a little longer. */
export function showToast(message: string, isError = false): void {
    window.clearTimeout(hideTimer);
    toastStore.set({message, isError, visible: true});
    hideTimer = window.setTimeout(() => {
        toastStore.set((state) => ({...state, visible: false}));
    }, isError ? 6000 : 2600);
}

export const useToast = () => useStore(toastStore);
