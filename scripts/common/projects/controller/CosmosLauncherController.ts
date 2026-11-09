import {dialog, ipcMain} from "electron";
import type {ServiceModel} from "../../models/ServiceModel";
import {CosmosIPC} from "../CosmosConnection";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's requests about the local services. Programs and folders are only chosen in native dialogs. */
export class CosmosLauncherController {
    constructor(private readonly windows: Pick<CosmosWindowController, "withDialog">, private readonly services: ServiceModel) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.listServices, () => this.services.list());
        ipcMain.handle(CosmosIPC.startService, (_event, id: unknown, confirmed: unknown) => this.services.start(String(id), confirmed === true));
        ipcMain.handle(CosmosIPC.stopService, (_event, id: unknown) => this.services.stop(String(id)));
        ipcMain.handle(CosmosIPC.patchService, (_event, id: unknown, changes: unknown) => this.services.patch(String(id), changes));
        ipcMain.handle(CosmosIPC.pickServiceBinary, (_event, id: unknown) => this.pick(String(id), "path"));
        ipcMain.handle(CosmosIPC.pickServiceFolder, (_event, id: unknown) => this.pick(String(id), "root"));
        ipcMain.handle(CosmosIPC.getServiceLogs, (_event, id: unknown) => this.services.logs(String(id)));
    }

    private async pick(id: string, kind: "path" | "root") {
        const result = await this.windows.withDialog((parent) => dialog.showOpenDialog(parent!, kind === "path"
            ? {title: "Choose the program", properties: ["openFile"]}
            : {title: "Choose the folder to share", properties: ["openDirectory"]}));
        const choice = result.filePaths[0];
        return result.canceled || !choice ? this.services.list() : this.services.setPath(id, kind, choice);
    }
}
