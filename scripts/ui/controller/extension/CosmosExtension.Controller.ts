import type {ExtensionList} from "../../../common/CommonInterface";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {loadRegistries, reloadRegistries, restoreRegistries} from "../registry/CosmosRegistry.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";

const extensionStore = createStore<ExtensionList>({extensions: [], folder: ""});
export const useExtensions = () => useStore(extensionStore);

export async function loadExtensions(): Promise<void> {
    extensionStore.set(await window.api.listExtensions());
}

/** Engines, languages and nodes come from extensions too, so they are read again after any change. */
async function apply(list: ExtensionList): Promise<void> {
    extensionStore.set(list);
    await loadRegistries();
}

export const setEnabled = exclusive(async (id: string, enabled: boolean): Promise<void> => {
    await apply(await window.api.setExtensionEnabled(id, enabled));
}, (id) => id);

export const installExtension = exclusive(async (): Promise<void> => {
    const list = await window.api.installExtension();
    if (list) {
        await apply(list);
        showToast("Extension installed");
    }
});

export const removeExtension = exclusive(async (id: string): Promise<void> => {
    const extension = extensionStore.get().extensions.find((item) => item.id === id);
    if (!extension) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Remove "${extension.name}"?`,
        message: "Its folder is deleted. Projects that use its engines, languages or nodes will show them as missing until you install it again.",
        confirmLabel: "Remove",
        danger: true,
        typeToConfirm: extension.name
    });
    if (confirmed) {
        await apply(await window.api.removeExtension(id));
    }
}, (id) => id);

export const reloadAll = async () => {
    await reloadRegistries();
    await loadExtensions();
};

export const restoreBuiltIns = async () => {
    await restoreRegistries();
    await loadExtensions();
};

export const openExtensionsFolder = exclusive(async (): Promise<void> => {
    await window.api.openExtensionsFolder();
});

export const openRegistryFolder = exclusive(async (): Promise<void> => {
    await window.api.openRegistryFolder();
});
