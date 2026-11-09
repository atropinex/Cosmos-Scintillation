import {dialog, ipcMain} from "electron";
import {promises as fs} from "fs";
import {dirname, join} from "path";
import type {ApiExportPreview, CosmosDatabase, ExportResult, ScriptImportResult} from "../../CommonInterface";
import type {GeneratedFile, GeneratedOutput} from "../../exporters/ExportTypes";
import {buildApi, checkPath} from "../../exporters/ApiExporter";
import {exportDatabase} from "../../exporters/DatabaseExporter";
import {readScript, writeScript} from "../../exporters/ScriptFile";
import {freeName, writeFileAtomic} from "../../models/FileModel";
import {sanitizeApi, sanitizeDatabase} from "../../models/ProjectSanitizer";
import type {RegistryModel} from "../../models/RegistryModel";
import {MAX_FILE_BYTES, SCRIPT_EXTENSION} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";
import {toKebab} from "../../utils/IdHelper";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's export requests: previews are built in memory, and files are only written after the user picked a folder. */
export class CosmosExportController {
    constructor(
        private readonly windows: Pick<CosmosWindowController, "withDialog">,
        private readonly registry: Pick<RegistryModel, "build">
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.previewDatabaseExport, (_event, database: unknown) => this.previewDatabase(database));
        ipcMain.handle(CosmosIPC.writeDatabaseExport, (_event, database: unknown, name: unknown, folder: unknown) => this.writeDatabase(database, name, folder));
        ipcMain.handle(CosmosIPC.previewApiExport, (_event, api: unknown, database: unknown, name: unknown) => this.previewApi(api, database, name));
        ipcMain.handle(CosmosIPC.writeApiExport, (_event, api: unknown, database: unknown, name: unknown, folder: unknown) => this.writeApi(api, database, name, folder));
        ipcMain.handle(CosmosIPC.exportScript, (_event, api: unknown) => this.exportScript(api));
        ipcMain.handle(CosmosIPC.importScript, () => this.importScript());
    }

    // === Databases === //

    private async previewDatabase(raw: unknown): Promise<GeneratedOutput> {
        const database = sanitizeDatabase(raw);
        if (!database) {
            return {files: [], notes: ["The database data is not valid."]};
        }
        return this.buildDatabase(database);
    }

    private async buildDatabase(database: CosmosDatabase): Promise<GeneratedOutput> {
        const {engines} = await this.registry.build();
        return exportDatabase(database, engines.find((engine) => engine.id === database.engine));
    }

    private async writeDatabase(raw: unknown, name: unknown, lastFolder: unknown): Promise<ExportResult> {
        const database = sanitizeDatabase(raw);
        if (!database) {
            return {ok: false, error: "The database data is not valid."};
        }
        const output = await this.buildDatabase(database);
        if (output.files.length === 0) {
            return {ok: false, error: output.notes[0] ?? "Nothing to export."};
        }
        return this.writeFiles(output.files, typeof name === "string" ? name : database.name, lastFolder);
    }

    // === APIs === //

    private async previewApi(rawApi: unknown, rawDatabase: unknown, _name: unknown): Promise<ApiExportPreview> {
        const api = sanitizeApi(rawApi);
        if (!api) {
            return {files: [], notes: ["Problem: the API data is not valid."], security: []};
        }
        const build = buildApi(api, this.databaseOf(rawDatabase), await this.registry.build(), true);
        return {files: build.files, notes: build.notes, security: build.security};
    }

    private async writeApi(rawApi: unknown, rawDatabase: unknown, name: unknown, lastFolder: unknown): Promise<ExportResult> {
        const api = sanitizeApi(rawApi);
        if (!api) {
            return {ok: false, error: "The API data is not valid."};
        }
        const build = buildApi(api, this.databaseOf(rawDatabase), await this.registry.build(), false);
        if (build.errors.length > 0) {
            return {ok: false, error: build.errors[0]};
        }
        return this.writeFiles(build.files, typeof name === "string" ? `${name} ${api.name}` : api.name, lastFolder);
    }

    private databaseOf(raw: unknown): CosmosDatabase | null {
        return raw ? sanitizeDatabase(raw) : null;
    }

    // === Scripts === //

    private async exportScript(raw: unknown): Promise<ExportResult> {
        const api = sanitizeApi(raw);
        if (!api) {
            return {ok: false, error: "The API data is not valid."};
        }

        const result = await this.windows.withDialog((parent) => {
            const options = {
                title: "Save the visual script",
                defaultPath: `${toKebab(api.name, "script")}.${SCRIPT_EXTENSION}`,
                filters: [{name: "Cosmos script", extensions: ["yaml"]}]
            };
            return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
        });
        if (result.canceled || !result.filePath) {
            return {ok: false, cancelled: true};
        }

        try {
            await writeFileAtomic(result.filePath, writeScript(api));
            return {ok: true, folder: dirname(result.filePath), fileCount: 1};
        } catch (error) {
            return {ok: false, error: (error as Error).message};
        }
    }

    private async importScript(): Promise<ScriptImportResult> {
        const result = await this.windows.withDialog((parent) => {
            const options = {
                title: "Open a visual script",
                properties: ["openFile" as const],
                filters: [{name: "Cosmos script", extensions: ["yaml", "yml"]}]
            };
            return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
        });
        if (result.canceled || result.filePaths.length === 0) {
            return {ok: false, cancelled: true, missingKinds: []};
        }

        try {
            const file = result.filePaths[0];
            if ((await fs.stat(file)).size > MAX_FILE_BYTES) {
                return {ok: false, cancelled: false, error: "That file is too big to be a script.", missingKinds: []};
            }
            const {nodes} = await this.registry.build();
            return readScript(await fs.readFile(file, "utf8"), new Set(nodes.map((node) => node.id)));
        } catch (error) {
            return {ok: false, cancelled: false, error: (error as Error).message, missingKinds: []};
        }
    }

    // === Writing === //

    /**
     * Asks for a folder and writes the files into it. Existing files are never overwritten: when a file is in the way,
     * everything goes into a new subfolder instead.
     */
    private async writeFiles(files: GeneratedFile[], name: string, lastFolder: unknown): Promise<ExportResult> {
        const bad = files.map((file) => checkPath(file.path)).find((problem) => problem !== null);
        if (bad) {
            return {ok: false, error: bad};
        }

        const result = await this.windows.withDialog((parent) => {
            const options = {
                title: "Choose where to save the files",
                properties: ["openDirectory" as const, "createDirectory" as const],
                defaultPath: typeof lastFolder === "string" && lastFolder ? lastFolder : undefined
            };
            return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
        });
        if (result.canceled || result.filePaths.length === 0) {
            return {ok: false, cancelled: true};
        }

        try {
            let folder = result.filePaths[0];
            const clash = await Promise.all(files.map((file) => fs.access(join(folder, file.path)).then(() => true, () => false)));
            if (clash.some(Boolean)) {
                folder = join(folder, await freeName(folder, toKebab(name, "export")));
            }
            for (const file of files) {
                await writeFileAtomic(join(folder, file.path), file.content);
            }
            return {ok: true, folder, fileCount: files.length};
        } catch (error) {
            return {ok: false, error: (error as Error).message};
        }
    }
}
