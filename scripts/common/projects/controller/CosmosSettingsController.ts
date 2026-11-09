import {app, ipcMain, shell} from "electron";
import type {MemoryInfo} from "../../CommonInterface";
import type {KeybindModel} from "../../models/KeybindModel";
import type {SettingsModel} from "../../models/SettingsModel";
import type {ThemeModel} from "../../models/ThemeModel";
import {Cooldown} from "../../utils/CooldownHelper";
import {SHORT_COOLDOWN_MS} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's requests about settings, themes, keybinds, memory and the window itself. */
export class CosmosSettingsController {
    private readonly cooldown = new Cooldown();

    constructor(
        private readonly windows: Pick<CosmosWindowController, "onRendererReady" | "onFlushDone" | "quit">,
        private readonly settings: SettingsModel,
        private readonly themes: ThemeModel,
        private readonly keybinds: KeybindModel
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.getSettings, () => this.settings.read());
        ipcMain.handle(CosmosIPC.patchSettings, (_event, changes: unknown) => this.settings.patchFromPage(changes));

        ipcMain.handle(CosmosIPC.listThemes, () => this.themes.load());
        ipcMain.handle(CosmosIPC.openThemesFolder, async () => {
            await this.themes.load(); // makes sure the folder exists
            await this.openFolder("themes", this.themes.folder);
        });

        ipcMain.handle(CosmosIPC.listKeybinds, () => this.keybinds.list());
        ipcMain.handle(CosmosIPC.setKeybind, (_event, id: unknown, keys: unknown) => {
            return this.keybinds.set(String(id), typeof keys === "string" ? keys : "");
        });
        ipcMain.handle(CosmosIPC.resetKeybinds, () => this.keybinds.reset());
        ipcMain.handle(CosmosIPC.openConfigFolder, () => this.openFolder("config", app.getPath("userData")));
        ipcMain.handle(CosmosIPC.getMemory, () => this.memory());

        // The page calls these as it loads and as the window closes.
        ipcMain.handle(CosmosIPC.appReady, () => this.windows.onRendererReady());
        ipcMain.handle(CosmosIPC.flushDone, () => this.windows.onFlushDone());
        ipcMain.handle(CosmosIPC.quitApp, () => this.windows.quit());
    }

    /** Memory of every process of the app. Electron reports kilobytes. */
    private memory(): MemoryInfo {
        const processes = app.getAppMetrics().map((metric) => ({
            name: metric.name ?? metric.type,
            pid: metric.pid,
            memoryMb: Math.round(metric.memory.workingSetSize / 1024)
        }));
        return {totalMb: processes.reduce((sum, item) => sum + item.memoryMb, 0), processes};
    }

    private async openFolder(key: string, path: string): Promise<void> {
        if (this.cooldown.tooSoon(key, SHORT_COOLDOWN_MS)) {
            return;
        }
        await shell.openPath(path);
    }
}
