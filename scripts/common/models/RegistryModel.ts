import {app} from "electron";
import {promises as fs} from "fs";
import {join} from "path";
import type {EngineDefinition, RegistryList} from "../CommonInterface";
import type {BuildRegistry} from "../codegen/CodegenTypes";
import {DEFAULT_REGISTRY_FILES} from "./DefaultFiles";
import {parseEngines} from "./EngineModel";
import type {ExtensionModel} from "./ExtensionModel";
import {seedFolder, writeFileAtomic} from "./FileModel";
import {parseLanguages} from "./LanguageModel";
import {parseNodes} from "./NodeModel";
import type {ProblemList, RegistryFile} from "./RegistryTypes";
import {parseServices, toDefinition, type ServiceSpec} from "./ServiceModel";

type Kind = keyof typeof DEFAULT_REGISTRY_FILES;
const KINDS = Object.keys(DEFAULT_REGISTRY_FILES) as Kind[];
const MAX_USER_FILE_BYTES = 512 * 1024;

interface Loaded {
    list: RegistryList;
    engines: EngineDefinition[];
    services: ServiceSpec[];
}

/**
 * The YAML registries (engines, languages, nodes, services). The built-in files are copied to the user's config
 * folder on the first run and belong to the user after that. Enabled extensions are read after them, so a file
 * from the config folder wins over an extension's file with the same id.
 */
export class RegistryModel {
    readonly folder = app.getPath("userData");
    private loaded: Promise<Loaded> | null = null;

    constructor(private readonly extensions: Pick<ExtensionModel, "files">) {
    }

    // === Reading === //

    async list(): Promise<RegistryList> {
        return (await this.load()).list;
    }

    async engines(): Promise<EngineDefinition[]> {
        return (await this.load()).engines;
    }

    async serviceSpecs(): Promise<ServiceSpec[]> {
        return (await this.load()).services;
    }

    /** Throws the cached result away, so the next read looks at the disk again. */
    async reload(): Promise<RegistryList> {
        this.loaded = null;
        return this.list();
    }

    /** Overwrites the built-in files in the config folder with the originals. Files the user added stay. */
    async restoreDefaults(): Promise<RegistryList> {
        for (const kind of KINDS) {
            await this.seed(kind, true);
        }
        return this.reload();
    }

    /** The complete languages and nodes (with code templates) for the exporters. Not cached: it is big. */
    async build(): Promise<BuildRegistry> {
        const problems: ProblemList = [];
        const [engineFiles, languageFiles, nodeFiles] = await Promise.all([this.files("engines"), this.files("languages"), this.files("nodes")]);
        return {
            engines: parseEngines(engineFiles, problems),
            languages: parseLanguages(languageFiles, problems).specs,
            nodes: parseNodes(nodeFiles, problems).specs
        };
    }

    // === Internals === //

    private load(): Promise<Loaded> {
        if (!this.loaded) {
            this.loaded = this.read();
        }
        return this.loaded;
    }

    private async read(): Promise<Loaded> {
        const problems: ProblemList = [];
        const engines = parseEngines(await this.files("engines"), problems);
        const languages = parseLanguages(await this.files("languages"), problems).summaries;
        const nodes = parseNodes(await this.files("nodes"), problems).summaries;
        const services = parseServices(await this.files("services"), problems);

        return {
            engines,
            services,
            list: {engines, languages, nodes, services: services.map(toDefinition), problems, folder: this.folder}
        };
    }

    /** The user's files first (source "built-in"), then the enabled extensions' files. */
    private async files(kind: Kind): Promise<RegistryFile[]> {
        await this.seed(kind, false);
        const folder = join(this.folder, kind);
        const result: RegistryFile[] = [];

        const names = (await fs.readdir(folder).catch(() => [] as string[])).filter((name) => /\.ya?ml$/i.test(name)).sort();
        for (const name of names) {
            const path = join(folder, name);
            const stat = await fs.stat(path).catch(() => null);
            if (stat?.isFile() && stat.size <= MAX_USER_FILE_BYTES) {
                result.push({name, text: await fs.readFile(path, "utf8").catch(() => ""), source: "built-in"});
            }
        }
        return result.concat(await this.extensions.files(kind));
    }

    /** Writes the default files when the folder does not exist yet (or always, when `overwrite` is true). Empty files are repaired. */
    private async seed(kind: Kind, overwrite: boolean): Promise<void> {
        const folder = join(this.folder, kind);
        const present = await fs.stat(folder).then((stat) => stat.isDirectory(), () => false);
        await fs.mkdir(folder, {recursive: true});
        if (overwrite) {
            for (const [name, text] of Object.entries(DEFAULT_REGISTRY_FILES[kind])) {
                await writeFileAtomic(join(folder, name), text);
            }
            return;
        }
        await seedFolder(folder, DEFAULT_REGISTRY_FILES[kind], !present);
    }
}
