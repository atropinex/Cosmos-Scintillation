import {dialog, ipcMain, shell} from "electron";
import type {ExtensionModel} from "../../models/ExtensionModel";
import type {RegistryModel} from "../../models/RegistryModel";
import {Cooldown} from "../../utils/CooldownHelper";
import {SHORT_COOLDOWN_MS} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's requests about extensions. Any change reloads the registries, since they merge extension files. */
export class CosmosExtensionController {
    private readonly cooldown = new Cooldown();

    constructor(
        private readonly windows: Pick<CosmosWindowController, "withDialog">,
        private readonly extensions: ExtensionModel,
        private readonly registry: Pick<RegistryModel, "reload">
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.listExtensions, () => this.extensions.list());
        ipcMain.handle(CosmosIPC.setExtensionEnabled, async (_event, id: unknown, enabled: unknown) => {
            const list = await this.extensions.setEnabled(id, enabled);
            await this.registry.reload();
            return list;
        });
        ipcMain.handle(CosmosIPC.removeExtension, async (_event, id: unknown) => {
            const list = await this.extensions.remove(id);
            await this.registry.reload();
            return list;
        });
        ipcMain.handle(CosmosIPC.installExtension, () => this.install());
        ipcMain.handle(CosmosIPC.openExtensionsFolder, async () => {
            if (!this.cooldown.tooSoon("extensions", SHORT_COOLDOWN_MS)) {
                await this.extensions.list();
                await shell.openPath(this.extensions.folder);
            }
        });
    }

    private async install() {
        const result = await this.windows.withDialog((parent) => dialog.showOpenDialog(parent!, {
            title: "Choose an extension folder (it contains extension.yaml)",
            properties: ["openDirectory"]
        }));
        const folder = result.filePaths[0];
        if (result.canceled || !folder) {
            return null;
        }

        const problem = await this.extensions.install(folder);
        if (problem) {
            await this.windows.withDialog((parent) => dialog.showMessageBox(parent!, {type: "error", message: "The extension was not installed.", detail: problem}));
        }
        await this.registry.reload();
        return this.extensions.list();
    }
}
