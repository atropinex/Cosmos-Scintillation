import {app} from "electron";
import {promises as fs} from "fs";
import {basename, extname, join} from "path";
import {parse} from "yaml";
import type {Theme, ThemeColors, ThemeList} from "../CommonInterface";
import {THEME_COLORS} from "../projects/CosmosContract";
import {isRecord, toNumber, toText} from "../utils/GuardHelper";
import {DEFAULT_THEME_FILES} from "./DefaultFiles";
import type {ExtensionModel} from "./ExtensionModel";
import {seedFolder} from "./FileModel";

/** Used for any value a theme file leaves out or gets wrong. Matches the Graphite theme. */
export const FALLBACK_COLORS: ThemeColors = {
    background: "#0f1012",
    panel: "#16171a",
    panelRaised: "#1e2024",
    text: "#e8e9eb",
    muted: "#8a8d94",
    accent: "#5b8def",
    onAccent: "#0a1020",
    danger: "#f26b6b"
};

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;
const isYaml = (name: string) => /\.ya?ml$/i.test(name);

/** Themes are YAML files in a folder. Extensions can add more. This reads and checks them. */
export class ThemeModel {
    readonly folder = join(app.getPath("userData"), "themes");

    constructor(private readonly extensions?: Pick<ExtensionModel, "files">) {
    }

    /** Reads every theme file. A broken file is reported without stopping the others. */
    async load(): Promise<ThemeList> {
        await this.ensureDefaults();

        const problems: string[] = [];
        const themes: Theme[] = [];
        const seen = new Set<string>();

        const files = (await fs.readdir(this.folder).catch(() => [] as string[])).filter(isYaml).sort();
        for (const file of files) {
            const source = await fs.readFile(join(this.folder, file), "utf8").catch(() => "");
            const theme = this.toTheme(file, source, problems);
            if (theme && !seen.has(theme.id)) {
                seen.add(theme.id);
                themes.push(theme);
            }
        }

        // Themes from extensions come after the user's own, and never replace one with the same id.
        for (const file of await (this.extensions?.files("themes") ?? Promise.resolve([]))) {
            const theme = this.toTheme(file.name, file.text, problems);
            if (theme && !seen.has(theme.id)) {
                seen.add(theme.id);
                themes.push({...theme, author: `${theme.author} (${file.source})`});
            }
        }
        return {themes, problems, folder: this.folder};
    }

    /** The first time the app runs the folder is filled with the built-in themes. After that the files belong to the user, except empty ones, which are repaired. */
    private async ensureDefaults(): Promise<void> {
        await fs.mkdir(this.folder, {recursive: true});
        const first = !(await fs.readdir(this.folder)).some(isYaml);
        await seedFolder(this.folder, DEFAULT_THEME_FILES, first);
    }

    private toTheme(file: string, source: string, problems: string[]): Theme | null {
        let raw: unknown;
        try {
            raw = parse(source);
        } catch (error) {
            problems.push(`${file}: ${(error as Error).message.split("\n")[0]}`);
            return null;
        }

        if (!isRecord(raw)) {
            problems.push(`${file}: expected a YAML mapping at the top level.`);
            return null;
        }

        const colors = isRecord(raw.colors) ? raw.colors : {};
        const id = basename(file, extname(file)).replace(/[^a-z0-9_-]/gi, "-");

        return {
            id,
            name: toText(raw.name, id, 60),
            author: toText(raw.author, "Unknown", 60),
            mode: raw.mode === "light" ? "light" : "dark",
            radius: toNumber(raw.radius, 10, 0, 24),
            motion: toNumber(raw.motion, 1, 0, 3),
            colors: Object.fromEntries(
                THEME_COLORS.map((key) => [key, this.toColor(colors, key, file, problems)])
            ) as ThemeColors
        };
    }

    private toColor(colors: Record<string, unknown>, key: keyof ThemeColors, file: string, problems: string[]): string {
        const value = colors[key];
        if (value === undefined) {
            return FALLBACK_COLORS[key];
        }
        if (typeof value === "string" && COLOR_PATTERN.test(value.trim())) {
            return value.trim();
        }
        problems.push(`${file}: "${key}" is not a valid colour (wrap hex colours in quotes). Using the default.`);
        return FALLBACK_COLORS[key];
    }
}
