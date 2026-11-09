import type {KeybindList, MemoryInfo, Settings} from "../../../common/CommonInterface";
import {createStore, useStore} from "../store/CosmosStore.Controller";

const FALLBACK: Settings = {
    themeId: "graphite",
    autosave: true,
    autosaveSeconds: 1.5,
    snapToGrid: true,
    gridSize: 16,
    rowsPerPage: 50,
    showSidebar: true,
    projectsFolder: "",
    recentProjects: [],
    disabledExtensions: [],
    services: {}
};

const settingsStore = createStore<Settings>(FALLBACK);
const keybindStore = createStore<KeybindList>({actions: [], file: ""});
const openStore = createStore<boolean>(false);
const memoryStore = createStore<MemoryInfo>({totalMb: 0, processes: []});

export const useSettings = () => useStore(settingsStore);
export const getSettings = () => settingsStore.get();
export const useKeybinds = () => useStore(keybindStore);
export const getKeybinds = () => keybindStore.get();
export const useSettingsOpen = () => useStore(openStore);
export const isSettingsOpen = () => openStore.get();
export const openSettings = () => openStore.set(true);
export const closeSettings = () => openStore.set(false);
export const useMemory = () => useStore(memoryStore);

export async function loadSettings(): Promise<Settings> {
    const settings = await window.api.getSettings();
    settingsStore.set(settings);
    return settings;
}

/** Applies the change on screen straight away, then saves it. */
export async function patchSettings(changes: Partial<Settings>): Promise<void> {
    settingsStore.set((state) => ({...state, ...changes}));
    const saved = await window.api.patchSettings(changes);
    settingsStore.set(saved);
}

export async function loadKeybinds(): Promise<void> {
    keybindStore.set(await window.api.listKeybinds());
}

export async function changeKeybind(id: string, keys: string): Promise<void> {
    keybindStore.set(await window.api.setKeybind(id, keys));
}

export async function resetKeybinds(): Promise<void> {
    keybindStore.set(await window.api.resetKeybinds());
}

/** Reads the memory the app uses. Only called while the settings are open, so it costs nothing the rest of the time. */
export async function refreshMemory(): Promise<void> {
    memoryStore.set(await window.api.getMemory());
}
