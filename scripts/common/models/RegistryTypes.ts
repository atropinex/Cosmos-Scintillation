/**
 * One YAML file of a registry (engines, languages, nodes, services), read from the user's config folder
 * or from an enabled extension. Models parse these; they never touch the disk themselves, so the parsers
 * also run in tests without Electron.
 */
export interface RegistryFile {
    /** The file name, for example "typescript.yaml". Used in problem messages. */
    name: string;
    text: string;
    /** "built-in", or the id of the extension the file came from. */
    source: string;
}

/** Collects problems as readable lines, one per broken file or value. */
export type ProblemList = string[];
