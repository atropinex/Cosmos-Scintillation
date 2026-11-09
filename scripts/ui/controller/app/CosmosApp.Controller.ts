import {startAutosave} from "../autosave/CosmosAutosave.Controller";
import {loadRecents} from "../project/CosmosProject.Controller";
import {loadRegistries} from "../registry/CosmosRegistry.Controller";
import {loadKeybinds, loadSettings} from "../settings/CosmosSettings.Controller";
import {initializeTheme} from "../theme/CosmosTheme.Controller";

/** Loads everything the page shows. Runs once, before the first render. */
export async function loadAppData(): Promise<void> {
    // Settings and theme first, so the window never flashes the wrong colours.
    const settings = await loadSettings();
    await initializeTheme(settings.themeId);

    startAutosave();
    watchVisibility();
    await Promise.all([loadKeybinds(), loadRegistries(), loadRecents()]);
}

/** While the window is hidden or minimised, animations pause (see main.css), so the app idles at no cost. */
function watchVisibility(): void {
    const apply = () => document.documentElement.setAttribute("data-hidden", String(document.hidden));
    document.addEventListener("visibilitychange", apply);
    apply();
}

let announced = false;

/** Tells the main process the page is drawn, so it can show the window. */
export function announceReady(): void {
    if (announced) {
        return;
    }
    announced = true;
    void window.api.appReady();
}
