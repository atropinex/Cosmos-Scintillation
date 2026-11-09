import type {Theme, ThemeList} from "../../../common/CommonInterface";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";

interface ThemeState {
    list: ThemeList;
    themeId: string;
}

const themeStore = createStore<ThemeState>({list: {themes: [], problems: [], folder: ""}, themeId: "graphite"});
export const useThemes = () => useStore(themeStore);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let current: Theme | null = null;

/** 0 when animation is off, otherwise the theme's duration multiplier. */
export const motionScale = () => (reducedMotion.matches ? 0 : current?.motion ?? 1);

/** Pushes a theme's values into CSS variables. Colours are registered properties, so they cross-fade. */
export function applyTheme(theme: Theme): void {
    current = theme;
    const root = document.documentElement.style;
    const {colors} = theme;

    root.setProperty("--background", colors.background);
    root.setProperty("--panel", colors.panel);
    root.setProperty("--panel-raised", colors.panelRaised);
    root.setProperty("--text", colors.text);
    root.setProperty("--muted", colors.muted);
    root.setProperty("--accent", colors.accent);
    root.setProperty("--on-accent", colors.onAccent);
    root.setProperty("--danger", colors.danger);
    root.setProperty("--radius", `${theme.radius}px`);
    root.setProperty("--motion", String(motionScale()));
    root.colorScheme = theme.mode;

    themeStore.set((state) => ({...state, themeId: theme.id}));
}

function applyThemeById(id: string): void {
    const {themes} = themeStore.get().list;
    const theme = themes.find((item) => item.id === id) ?? themes[0];
    if (theme) {
        applyTheme(theme);
    }
}

/** Loads the themes and applies the one that is saved in the settings. */
export async function initializeTheme(themeId: string): Promise<void> {
    const list = await window.api.listThemes();
    themeStore.set({list, themeId});
    applyThemeById(themeId);

    // Animation follows the system's "reduce motion" switch while the app is running.
    reducedMotion.addEventListener("change", () => {
        if (current) {
            applyTheme(current);
        }
    });
}

export const chooseTheme = exclusive(async (id: string): Promise<void> => {
    await window.api.patchSettings({themeId: id});
    applyThemeById(id);
});

/** Reads the YAML files again, so edits to a theme show up without restarting. */
export const reloadThemes = exclusive(async (): Promise<void> => {
    const list = await window.api.listThemes();
    themeStore.set((state) => ({...state, list}));
    applyThemeById(themeStore.get().themeId);
    showToast("Themes reloaded");
});

export const openThemesFolder = exclusive(async (): Promise<void> => {
    await window.api.openThemesFolder();
});
