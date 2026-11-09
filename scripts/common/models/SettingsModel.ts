import type {ServiceSettings, Settings} from "../CommonInterface";
import {
    DEFAULT_AUTOSAVE_SECONDS, DEFAULT_GRID_SIZE, DEFAULT_ROWS_PER_PAGE, DEFAULT_THEME_ID, MAX_PORT, MAX_RECENT_PROJECTS
} from "../projects/CosmosConfig";
import {isRecord, toBoolean, toNumber, toText} from "../utils/GuardHelper";
import {YamlStoreModel} from "./YamlStoreModel";

const DEFAULTS: Settings = {
    themeId: DEFAULT_THEME_ID,
    autosave: true,
    autosaveSeconds: DEFAULT_AUTOSAVE_SECONDS,
    snapToGrid: true,
    gridSize: DEFAULT_GRID_SIZE,
    rowsPerPage: DEFAULT_ROWS_PER_PAGE,
    showSidebar: true,
    projectsFolder: "",
    recentProjects: [],
    disabledExtensions: [],
    services: {}
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = {path: "", port: 0, root: "", autoStart: false};

export function parseServiceSettings(raw: unknown): ServiceSettings {
    const data = isRecord(raw) ? raw : {};
    return {
        path: toText(data.path, "", 1000),
        port: Math.round(toNumber(data.port, 0, 0, MAX_PORT)),
        root: toText(data.root, "", 1000),
        autoStart: toBoolean(data.autoStart, false)
    };
}

function parseSettings(raw: unknown): Settings {
    const data = isRecord(raw) ? raw : {};
    const strings = (value: unknown, limit: number) => (Array.isArray(value) ? value : [])
        .filter((item): item is string => typeof item === "string")
        .slice(0, limit);

    const services: Record<string, ServiceSettings> = {};
    if (isRecord(data.services)) {
        for (const [id, value] of Object.entries(data.services)) {
            if (ID_PATTERN.test(id)) {
                services[id] = parseServiceSettings(value);
            }
        }
    }

    return {
        themeId: toText(data.themeId, DEFAULTS.themeId, 80),
        autosave: toBoolean(data.autosave, DEFAULTS.autosave),
        autosaveSeconds: toNumber(data.autosaveSeconds, DEFAULTS.autosaveSeconds, 0.3, 120),
        snapToGrid: toBoolean(data.snapToGrid, DEFAULTS.snapToGrid),
        gridSize: Math.round(toNumber(data.gridSize, DEFAULTS.gridSize, 1, 256)),
        rowsPerPage: Math.round(toNumber(data.rowsPerPage, DEFAULTS.rowsPerPage, 10, 500)),
        showSidebar: toBoolean(data.showSidebar, DEFAULTS.showSidebar),
        projectsFolder: toText(data.projectsFolder, "", 1000),
        recentProjects: strings(data.recentProjects, MAX_RECENT_PROJECTS),
        disabledExtensions: strings(data.disabledExtensions, 200),
        services
    };
}

/** The keys the page may change through patchSettings. The rest is managed by the main process. */
const PAGE_KEYS: ReadonlyArray<keyof Settings> = [
    "themeId", "autosave", "autosaveSeconds", "snapToGrid", "gridSize", "rowsPerPage", "showSidebar"
];

/** The app's settings, saved on this computer as settings.yaml. */
export class SettingsModel {
    private readonly store = new YamlStoreModel<Settings>("settings.yaml", parseSettings);

    read(): Promise<Settings> {
        return this.store.read();
    }

    update(change: (settings: Settings) => Settings): Promise<Settings> {
        return this.store.update((settings) => parseSettings(change(settings)));
    }

    /** Applies changes that came from the page, ignoring any key it is not allowed to touch. */
    patchFromPage(changes: unknown): Promise<Settings> {
        const allowed: Record<string, unknown> = {};
        if (isRecord(changes)) {
            for (const key of PAGE_KEYS) {
                if (key in changes) {
                    allowed[key] = changes[key];
                }
            }
        }
        return this.update((settings) => ({...settings, ...allowed}));
    }

    /** Settings of one service, with the defaults filled in. */
    async serviceSettings(id: string, defaultPort: number): Promise<ServiceSettings> {
        const saved = (await this.read()).services[id];
        const merged = {...DEFAULT_SERVICE_SETTINGS, ...saved};
        return {...merged, port: merged.port || defaultPort};
    }
}
