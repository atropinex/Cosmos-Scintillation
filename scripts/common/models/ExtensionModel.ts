import {app} from "electron";
import {promises as fs} from "fs";
import {join} from "path";
import {parse, stringify} from "yaml";
import type {ExtensionInfo, ExtensionList} from "../CommonInterface";
import {EXTENSION_FILE} from "../projects/CosmosConfig";
import {EXTENSION_KINDS, type ExtensionKind} from "../projects/CosmosContract";
import {isRecord, toText} from "../utils/GuardHelper";
import {SerialQueue} from "./FileModel";
import type {RegistryFile} from "./RegistryTypes";
import type {SettingsModel} from "./SettingsModel";

/** Ids become folder names, so only these characters are allowed (no dots, no slashes). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_FILE = /^[A-Za-z0-9_.-]{1,80}\.ya?ml$/i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_PER_KIND = 200;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Which YAML files of one folder are safe to use: plain files with a plain name, never links. */
async function yamlFiles(folder: string): Promise<Array<{name: string; path: string; size: number}>> {
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    const files: Array<{name: string; path: string; size: number}> = [];
    for (const name of names.sort().slice(0, MAX_FILES_PER_KIND * 2)) {
        if (!SAFE_FILE.test(name)) {
            continue;
        }
        const path = join(folder, name);
        const stat = await fs.lstat(path).catch(() => null);
        if (stat && stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FILE_BYTES) {
            files.push({name, path, size: stat.size});
        }
        if (files.length >= MAX_FILES_PER_KIND) {
            break;
        }
    }
    return files;
}

/**
 * Extensions are folders of YAML files in the app's `extensions` folder. They hold data only, so nothing in
 * here ever runs code. Installing copies the YAML files of the five allowed sub folders and nothing else.
 */
export class ExtensionModel {
    readonly folder = join(app.getPath("userData"), "extensions");
    private readonly queue = new SerialQueue();

    constructor(private readonly settings: Pick<SettingsModel, "read" | "update">) {
    }

    // === Reading === //

    async list(): Promise<ExtensionList> {
        const disabled = new Set((await this.settings.read()).disabledExtensions);
        const extensions: ExtensionInfo[] = [];

        for (const entry of await this.entries()) {
            const problems: string[] = [];
            const meta = await this.readMeta(entry, problems);
            const contributes: ExtensionInfo["contributes"] = {};
            for (const kind of EXTENSION_KINDS) {
                const count = (await yamlFiles(join(this.folder, entry, kind))).length;
                if (count > 0) {
                    contributes[kind] = count;
                }
            }
            extensions.push({
                id: entry,
                name: toText(meta.name, entry, 80),
                version: toText(meta.version, "", 20),
                author: toText(meta.author, "", 80),
                description: toText(meta.description, "", 400),
                enabled: !disabled.has(entry),
                contributes,
                folder: join(this.folder, entry),
                problems
            });
        }
        return {extensions, folder: this.folder};
    }

    /** The YAML files of one kind from every enabled extension. */
    async files(kind: ExtensionKind): Promise<RegistryFile[]> {
        const disabled = new Set((await this.settings.read()).disabledExtensions);
        const result: RegistryFile[] = [];
        let total = 0;

        for (const entry of await this.entries()) {
            if (disabled.has(entry)) {
                continue;
            }
            for (const file of await yamlFiles(join(this.folder, entry, kind))) {
                total += file.size;
                if (total > MAX_TOTAL_BYTES) {
                    return result;
                }
                const text = await fs.readFile(file.path, "utf8").catch(() => "");
                result.push({name: `${entry}/${file.name}`, text, source: entry});
            }
        }
        return result;
    }

    // === Changing === //

    async setEnabled(id: unknown, enabled: unknown): Promise<ExtensionList> {
        if (typeof id === "string" && SAFE_ID.test(id)) {
            await this.settings.update((settings) => {
                const rest = settings.disabledExtensions.filter((item) => item !== id);
                return {...settings, disabledExtensions: enabled === true ? rest : [...rest, id]};
            });
        }
        return this.list();
    }

    async remove(id: unknown): Promise<ExtensionList> {
        if (typeof id === "string" && SAFE_ID.test(id)) {
            await this.queue.run(() => fs.rm(join(this.folder, id), {recursive: true, force: true}));
        }
        return this.list();
    }

    /** Copies an extension folder the user picked. Returns the problem as text, or "" when it worked. */
    install(source: string): Promise<string> {
        return this.queue.run(async () => {
            try {
                const meta = await this.readMeta(source, [], true);
                const id = typeof meta.id === "string" ? meta.id : "";
                if (!SAFE_ID.test(id)) {
                    return `${EXTENSION_FILE} needs an "id" made of letters, digits, "-" and "_".`;
                }

                const target = join(this.folder, id);
                const temporary = `${target}.installing`;
                await fs.rm(temporary, {recursive: true, force: true});
                await fs.mkdir(temporary, {recursive: true});

                let copied = 0;
                let total = 0;
                for (const kind of EXTENSION_KINDS) {
                    for (const file of await yamlFiles(join(source, kind))) {
                        total += file.size;
                        if (total > MAX_TOTAL_BYTES) {
                            await fs.rm(temporary, {recursive: true, force: true});
                            return "The extension is too big.";
                        }
                        await fs.mkdir(join(temporary, kind), {recursive: true});
                        await fs.copyFile(file.path, join(temporary, kind, file.name));
                        copied++;
                    }
                }
                if (copied === 0) {
                    await fs.rm(temporary, {recursive: true, force: true});
                    return "The folder has no YAML files in engines, languages, nodes, services or themes.";
                }

                const clean = {
                    id, name: toText(meta.name, id, 80), version: toText(meta.version, "", 20),
                    author: toText(meta.author, "", 80), description: toText(meta.description, "", 400)
                };
                await fs.writeFile(join(temporary, EXTENSION_FILE), stringify(clean), "utf8");
                await fs.rm(target, {recursive: true, force: true});
                await fs.rename(temporary, target);
                return "";
            } catch (error) {
                return (error as Error).message.slice(0, 200);
            }
        });
    }

    // === Internals === //

    private async entries(): Promise<string[]> {
        const names = await fs.readdir(this.folder).catch(() => [] as string[]);
        const result: string[] = [];
        for (const name of names.sort()) {
            const stat = await fs.lstat(join(this.folder, name)).catch(() => null);
            if (stat && stat.isDirectory() && !stat.isSymbolicLink() && SAFE_ID.test(name)) {
                result.push(name);
            }
        }
        return result;
    }

    /** `where` is an installed extension's folder name, or (with `absolute`) a folder the user picked. */
    private async readMeta(where: string, problems: string[], absolute = false): Promise<Record<string, unknown>> {
        const file = absolute ? join(where, EXTENSION_FILE) : join(this.folder, where, EXTENSION_FILE);
        try {
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
                throw new Error("not a small plain file");
            }
            const raw: unknown = parse(await fs.readFile(file, "utf8"));
            return isRecord(raw) ? raw : {};
        } catch (error) {
            problems.push(`${EXTENSION_FILE}: ${(error as Error).message.split("\n")[0]}`);
            return {};
        }
    }
}
