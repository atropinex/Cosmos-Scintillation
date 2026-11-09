// The built-in YAML files. They are written to the user's config folder the first time the app runs,
// and after that they belong to the user. They are read from disk (never bundled), so the bundler
// never sees a .yaml file and the files stay easy to open and edit.
import {app} from "electron";
import {readdirSync, readFileSync} from "fs";
import {join} from "path";

type Files = Record<string, string>;

/** `scripts/defaults` inside the project in development, and inside the packaged app otherwise. */
const ROOT = join(app.getAppPath(), "scripts", "defaults");

/** Every .yaml file of one defaults folder, by file name. A missing folder is simply empty. */
function readFolder(folder: string): Files {
    const files: Files = {};
    try {
        for (const name of readdirSync(join(ROOT, folder)).sort()) {
            if (name.endsWith(".yaml")) {
                files[name] = readFileSync(join(ROOT, folder, name), "utf8");
            }
        }
    } catch {
        // Nothing to copy from this folder.
    }
    return files;
}

export const DEFAULT_ENGINE_FILES: Files = readFolder("engines");
export const DEFAULT_LANGUAGE_FILES: Files = readFolder("languages");
export const DEFAULT_NODE_FILES: Files = readFolder("nodes");
export const DEFAULT_SERVICE_FILES: Files = readFolder("services");
export const DEFAULT_THEME_FILES: Files = readFolder("themes");

export const DEFAULT_KEYBINDS_FILE: string = readFolder("keybinds")["keybinds.yaml"] ?? "actions: []\n";

/** The registry folders that hold YAML files, by the name used in userData. */
export const DEFAULT_REGISTRY_FILES = {
    engines: DEFAULT_ENGINE_FILES,
    languages: DEFAULT_LANGUAGE_FILES,
    nodes: DEFAULT_NODE_FILES,
    services: DEFAULT_SERVICE_FILES
} as const;
