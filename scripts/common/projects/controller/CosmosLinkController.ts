import {dialog, ipcMain} from "electron";
import {promises as fs} from "fs";
import {basename} from "path";
import type {LinkImportResult} from "../../CommonInterface";
import type {LinkModel} from "../../models/LinkModel";
import type {SocketModel} from "../../models/SocketModel";
import {MAX_FILE_BYTES} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's requests about the user's own APIs and sockets. Secrets are only ever decrypted in here. */
export class CosmosLinkController {
    constructor(
        private readonly windows: Pick<CosmosWindowController, "withDialog">,
        private readonly links: LinkModel,
        private readonly sockets: SocketModel
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.importLink, () => this.importLink());
        ipcMain.handle(CosmosIPC.encryptSecret, (_event, plain: unknown) => this.links.encryptSecret(plain));
        ipcMain.handle(CosmosIPC.sendRequest, (_event, request: unknown) => this.links.sendRequest(request));
        ipcMain.handle(CosmosIPC.socketOpen, (_event, link: unknown) => this.sockets.open(link));
        ipcMain.handle(CosmosIPC.socketSend, (_event, id: unknown, text: unknown) => this.sockets.send(id, text));
        ipcMain.handle(CosmosIPC.socketClose, (_event, id: unknown) => this.sockets.close(id));
    }

    private async importLink(): Promise<LinkImportResult> {
        const result = await this.windows.withDialog((parent) => dialog.showOpenDialog(parent!, {
            title: "Import an OpenAPI, Swagger or AsyncAPI file",
            properties: ["openFile"],
            filters: [{name: "API description", extensions: ["json", "yaml", "yml"]}]
        }));
        const path = result.filePaths[0];
        if (result.canceled || !path) {
            return {ok: false, cancelled: true};
        }

        try {
            const stat = await fs.stat(path);
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
                return {ok: false, cancelled: false, error: "The file is too big."};
            }
            const outcome = this.links.importText(await fs.readFile(path, "utf8"), basename(path));
            return "link" in outcome ? {ok: true, cancelled: false, link: outcome.link} : {ok: false, cancelled: false, error: outcome.error};
        } catch (error) {
            return {ok: false, cancelled: false, error: (error as Error).message.slice(0, 200)};
        }
    }
}
