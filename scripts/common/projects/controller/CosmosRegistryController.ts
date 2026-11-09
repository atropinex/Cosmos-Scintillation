import {ipcMain, shell} from "electron";
import type {RegistryModel} from "../../models/RegistryModel";
import {Cooldown} from "../../utils/CooldownHelper";
import {SHORT_COOLDOWN_MS} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";

/** Answers the page's requests about engines, languages, nodes and services. */
export class CosmosRegistryController {
    private readonly cooldown = new Cooldown();

    constructor(private readonly registry: RegistryModel) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.listRegistries, () => this.registry.list());
        ipcMain.handle(CosmosIPC.reloadRegistries, () => this.registry.reload());
        ipcMain.handle(CosmosIPC.restoreRegistries, () => this.registry.restoreDefaults());
        ipcMain.handle(CosmosIPC.openRegistryFolder, async () => {
            if (!this.cooldown.tooSoon("registry", SHORT_COOLDOWN_MS)) {
                await this.registry.list(); // makes sure the folders exist
                await shell.openPath(this.registry.folder);
            }
        });
    }
}
