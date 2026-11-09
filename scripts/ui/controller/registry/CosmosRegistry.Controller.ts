import type {
    EngineDefinition, LanguageSummary, NodeDefinition, RegistryList, ServiceDefinition
} from "../../../common/CommonInterface";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";

const EMPTY: RegistryList = {engines: [], languages: [], nodes: [], services: [], problems: [], folder: ""};

const registryStore = createStore<RegistryList>(EMPTY);
export const useRegistries = () => useStore(registryStore);
export const getRegistries = () => registryStore.get();

export const getEngine = (id: string): EngineDefinition | undefined => registryStore.get().engines.find((item) => item.id === id);
export const getLanguage = (id: string): LanguageSummary | undefined => registryStore.get().languages.find((item) => item.id === id);
export const getNodeDefinition = (kind: string): NodeDefinition | undefined => registryStore.get().nodes.find((item) => item.id === kind);
export const getService = (id: string): ServiceDefinition | undefined => registryStore.get().services.find((item) => item.id === id);

export async function loadRegistries(): Promise<void> {
    registryStore.set(await window.api.listRegistries());
}

/** Reads the YAML files again, so edits and new extensions show up without restarting. */
export const reloadRegistries = exclusive(async (): Promise<void> => {
    registryStore.set(await window.api.reloadRegistries());
    showToast("Engines, languages and nodes reloaded");
});

export const restoreRegistries = exclusive(async (): Promise<void> => {
    registryStore.set(await window.api.restoreRegistries());
    showToast("Built-in files restored");
});

export const openRegistryFolder = exclusive(async (): Promise<void> => {
    await window.api.openRegistryFolder();
});
