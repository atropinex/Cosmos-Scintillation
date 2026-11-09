import {dialog, ipcMain, shell} from "electron";
import {basename, isAbsolute} from "path";
import type {ProjectFile} from "../../CommonInterface";
import type {ProjectModel} from "../../models/ProjectModel";
import type {RegistryModel} from "../../models/RegistryModel";
import {isOneOf} from "../../utils/GuardHelper";
import {PROJECT_FILE} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";
import {PROJECT_KINDS} from "../CosmosContract";
import type {CosmosWindowController} from "./CosmosWindowController";

/** Answers the page's requests about project files. The page may only touch projects the main process knows. */
export class CosmosProjectController {
    constructor(
        private readonly windows: Pick<CosmosWindowController, "withDialog">,
        private readonly projects: ProjectModel,
        private readonly registry: Pick<RegistryModel, "list" | "engines">
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.listRecents, () => this.projects.listRecents());
        ipcMain.handle(CosmosIPC.createProject, (_event, name: unknown, kind: unknown, engineId: unknown) => this.create(name, kind, engineId));
        ipcMain.handle(CosmosIPC.openProjectDialog, () => this.openDialog());
        ipcMain.handle(CosmosIPC.openProject, (_event, path: unknown) => this.open(path));
        ipcMain.handle(CosmosIPC.saveProject, async (_event, path: unknown, project: unknown) => {
            if (!(await this.projects.isKnown(path))) {
                return {ok: false, error: "That project is not open."};
            }
            return this.projects.write(path as string, project);
        });
        ipcMain.handle(CosmosIPC.removeRecent, async (_event, path: unknown) => {
            if (typeof path === "string") {
                await this.projects.forget(path);
            }
        });
        ipcMain.handle(CosmosIPC.revealPath, async (_event, path: unknown) => {
            if (await this.projects.isKnown(path)) {
                shell.showItemInFolder(path as string);
            }
        });
    }

    private async create(name: unknown, kind: unknown, engineId: unknown): Promise<ProjectFile | null> {
        if (typeof name !== "string" || !isOneOf(PROJECT_KINDS, kind)) {
            return null;
        }
        const engines = await this.registry.engines();
        const engine = engines.find((item) => item.id === engineId) ?? (kind === "api" ? null : engines[0] ?? null);

        // The first language that can make a REST API, preferring TypeScript.
        const {languages} = await this.registry.list();
        const language = (languages.find((item) => item.id === "typescript") ?? languages.find((item) => item.capabilities.includes("rest")) ?? languages[0])?.id ?? "typescript";
        return this.projects.create(name, kind, engine, language);
    }

    private async openDialog(): Promise<ProjectFile | null> {
        const result = await this.windows.withDialog((parent) => dialog.showOpenDialog(parent!, {
            title: "Open a project",
            properties: ["openFile"],
            filters: [{name: "Cosmos project", extensions: ["yaml"]}]
        }));
        const path = result.filePaths[0];
        if (result.canceled || !path || basename(path) !== PROJECT_FILE || !isAbsolute(path)) {
            return null;
        }

        const file = await this.projects.read(path);
        if (file) {
            await this.projects.remember(path);
        }
        return file;
    }

    private async open(path: unknown): Promise<ProjectFile | null> {
        if (typeof path !== "string" || !isAbsolute(path) || basename(path) !== PROJECT_FILE) {
            return null;
        }
        const file = await this.projects.read(path);
        if (file) {
            await this.projects.remember(path);
        }
        return file;
    }
}
