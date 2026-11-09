import {app} from "electron";
import {promises as fs} from "fs";
import {basename, dirname, join} from "path";
import {parse, stringify} from "yaml";
import type {EngineDefinition, ProjectFile, RecentProject, SaveResult} from "../CommonInterface";
import {MAX_FILE_BYTES, MAX_RECENT_PROJECTS, PROJECT_FILE, PROJECTS_FOLDER_NAME} from "../projects/CosmosConfig";
import type {ProjectKind} from "../projects/CosmosContract";
import {createProject} from "../utils/ProjectFactory";
import {freeName, SerialQueue, writeFileAtomic} from "./FileModel";
import {sanitizeProject} from "./ProjectSanitizer";
import {SettingsModel} from "./SettingsModel";

/** A project is a folder with a project.cosmos.yaml file. Table rows live next to it in a data folder. */
export class ProjectModel {
    private readonly queue = new SerialQueue();

    constructor(private readonly settings: SettingsModel) {
    }

    /** Where new projects go: the folder from the settings, or Documents/Cosmos-Scintillation. */
    async projectsFolder(): Promise<string> {
        const {projectsFolder} = await this.settings.read();
        return projectsFolder || join(app.getPath("documents"), PROJECTS_FOLDER_NAME);
    }

    async create(name: string, kind: ProjectKind, engine: EngineDefinition | null, language: string): Promise<ProjectFile> {
        const cleanName = name.trim().slice(0, 80) || "Untitled";
        const root = await this.projectsFolder();
        await fs.mkdir(root, {recursive: true});

        const folderName = (await freeName(root, cleanName.replace(/[\\/:*?"<>|]/g, "-"))).trim();
        const path = join(root, folderName, PROJECT_FILE);
        const project = createProject(cleanName, kind, engine, language);

        await this.write(path, project);
        await this.remember(path);
        return {path, project};
    }

    /** Reads and checks a project file. Null when it is missing, too big, or not a Cosmos-Scintillation project. */
    async read(path: string): Promise<ProjectFile | null> {
        try {
            const stat = await fs.stat(path);
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
                return null;
            }
            const raw = parse(await fs.readFile(path, "utf8"));
            const project = sanitizeProject(raw, basename(dirname(path)));
            return project ? {path, project} : null;
        } catch {
            return null;
        }
    }

    /** Checks the project that came from the page, then writes it. Writes to one file never overlap. */
    write(path: string, project: unknown): Promise<SaveResult> {
        return this.queue.run(async () => {
            const clean = sanitizeProject(project);
            if (!clean) {
                return {ok: false, error: "The project data is not valid."};
            }

            try {
                clean.updatedAt = new Date().toISOString();
                await writeFileAtomic(path, stringify(clean, {lineWidth: 0}));
                return {ok: true, updatedAt: clean.updatedAt};
            } catch (error) {
                return {ok: false, error: (error as Error).message};
            }
        });
    }

    // === Recent projects === //

    /** Only project files the main process opened or created are accepted from the page, so it can't pick any path. */
    async isKnown(path: unknown): Promise<boolean> {
        if (typeof path !== "string" || basename(path) !== PROJECT_FILE) {
            return false;
        }
        return (await this.settings.read()).recentProjects.includes(path);
    }

    async remember(path: string): Promise<void> {
        await this.settings.update((settings) => ({
            ...settings,
            recentProjects: [path, ...settings.recentProjects.filter((item) => item !== path)].slice(0, MAX_RECENT_PROJECTS)
        }));
    }

    async forget(path: string): Promise<void> {
        await this.settings.update((settings) => ({
            ...settings,
            recentProjects: settings.recentProjects.filter((item) => item !== path)
        }));
    }

    async listRecents(): Promise<RecentProject[]> {
        const {recentProjects} = await this.settings.read();
        const recents: RecentProject[] = [];

        for (const path of recentProjects) {
            const file = await this.read(path);
            const stat = await fs.stat(path).catch(() => null);
            recents.push({
                path,
                name: file?.project.name ?? basename(dirname(path)),
                kind: file?.project.kind ?? "both",
                exists: file !== null,
                updatedAt: file?.project.updatedAt ?? stat?.mtime.toISOString() ?? "",
                databaseCount: file?.project.databases.length ?? 0,
                apiCount: file?.project.apis.length ?? 0,
                preview: {
                    tables: (file?.project.databases[0]?.tables ?? []).slice(0, 5).map((table) => ({name: table.name, columns: table.columns.length})),
                    apis: (file?.project.apis ?? []).slice(0, 3).map((api) => api.name),
                    linkCount: file?.project.links.length ?? 0
                }
            });
        }
        return recents;
    }
}
