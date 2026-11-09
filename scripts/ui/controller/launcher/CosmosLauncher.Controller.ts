import type {ServiceSettings, ServiceState} from "../../../common/CommonInterface";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {getDocument} from "../document/CosmosDocument.Controller";
import {getService} from "../registry/CosmosRegistry.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";

const serviceStore = createStore<ServiceState[]>([]);
export const useServices = () => useStore(serviceStore);

let unsubscribe: (() => void) | null = null;

/** Loads the services and listens for changes. Called when the launcher opens. */
export async function startWatching(): Promise<void> {
    unsubscribe?.();
    unsubscribe = window.api.onServiceChange((states) => serviceStore.set(states));
    serviceStore.set(await window.api.listServices());
}

/** Stops listening. Called when the launcher closes, so the page does no work in the background. */
export function stopWatching(): void {
    unsubscribe?.();
    unsubscribe = null;
}

export const startService = exclusive(async (id: string): Promise<void> => {
    const state = serviceStore.get().find((item) => item.id === id);
    const definition = getService(id);
    if (!state) {
        return;
    }

    // A service from an extension runs a program, so the user decides first.
    if (state.needsConfirm) {
        const confirmed = await requestConfirm({
            title: `Start "${definition?.name ?? id}"?`,
            message: `This service comes from an extension and runs the program ${state.resolvedPath || "you chose"} on your computer. Only start it if you trust the extension.`,
            confirmLabel: "Start"
        });
        if (!confirmed) {
            return;
        }
    }
    serviceStore.set(await window.api.startService(id, true));
}, (id) => id);

export const stopService = exclusive(async (id: string): Promise<void> => {
    serviceStore.set(await window.api.stopService(id));
}, (id) => id);

export async function startAll(): Promise<void> {
    for (const state of serviceStore.get()) {
        if (state.status === "stopped" && !state.needsConfirm && (state.resolvedPath || getService(state.id)?.kind === "builtin-static")) {
            await startService(state.id);
        }
    }
}

export async function stopAll(): Promise<void> {
    for (const state of serviceStore.get()) {
        if (state.status === "running" || state.status === "starting") {
            await stopService(state.id);
        }
    }
}

export async function changeService(id: string, changes: Partial<ServiceSettings>): Promise<void> {
    serviceStore.set(await window.api.patchService(id, changes));
}

export const findProgram = exclusive(async (id: string): Promise<void> => {
    serviceStore.set(await window.api.pickServiceBinary(id));
}, (id) => id);

export const pickFolder = exclusive(async (id: string): Promise<void> => {
    serviceStore.set(await window.api.pickServiceFolder(id));
}, (id) => id);

/** Shares the folder of the open project. */
export async function useProjectFolder(id: string): Promise<void> {
    const {path} = getDocument();
    if (!path) {
        showToast("Open a project first.", true);
        return;
    }
    await changeService(id, {root: path.replace(/[\\/][^\\/]*$/, "")});
}

export const fetchLogs = (id: string) => window.api.getServiceLogs(id);
