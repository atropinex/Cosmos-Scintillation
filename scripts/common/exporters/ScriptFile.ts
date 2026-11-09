import {parse, stringify} from "yaml";
import type {ApiNode, CosmosApi, ScriptImportResult} from "../CommonInterface";
import {MAX_FILE_BYTES, SCRIPT_FORMAT, SCRIPT_VERSION} from "../projects/CosmosConfig";
import {isRecord} from "../utils/GuardHelper";
import {makeId} from "../utils/IdHelper";
import {sanitizeApi} from "../models/ProjectSanitizer";

// === The *.cosmos-script.yaml file (docs/FORMATS.md section 6) === //

/** The file's text. The database the API was bound to is not part of it, and neither are ids of other things. */
export function writeScript(api: CosmosApi): string {
    const kinds = [...new Set(api.graph.nodes.map((node) => node.kind))].sort();
    return stringify({
        format: SCRIPT_FORMAT,
        version: SCRIPT_VERSION,
        name: api.name,
        language: api.language,
        packages: api.packages,
        security: api.security,
        port: api.port,
        basePath: api.basePath,
        kinds,
        graph: {nodes: api.graph.nodes, links: api.graph.links}
    });
}

const failure = (error: string): ScriptImportResult => ({ok: false, cancelled: false, error, missingKinds: []});

/**
 * Reads a script file. The content goes through the same sanitiser as a project file (types, limits, safe ids),
 * then every id is replaced with a fresh one so the API can be added next to the original. `knownKinds` are the
 * node ids this installation has; the others are reported, not dropped, so the graph can still be repaired.
 */
export function readScript(text: string, knownKinds: ReadonlySet<string>): ScriptImportResult {
    if (text.length > MAX_FILE_BYTES) {
        return failure("That file is too big to be a script.");
    }

    let raw: unknown;
    try {
        raw = parse(text, {maxAliasCount: 20});
    } catch (error) {
        return failure(`The file is not valid YAML: ${(error as Error).message.split("\n")[0]}`);
    }
    if (!isRecord(raw) || raw.format !== SCRIPT_FORMAT) {
        return failure("This is not a Cosmos script file.");
    }
    if (typeof raw.version !== "number" || raw.version > SCRIPT_VERSION) {
        return failure("This script was made by a newer version of the app.");
    }

    const api = sanitizeApi({
        name: raw.name, language: raw.language, packages: raw.packages, security: raw.security,
        port: raw.port, basePath: raw.basePath, graph: raw.graph, databaseId: ""
    });
    if (!api) {
        return failure("The script has no usable content.");
    }

    const renamed = new Map<string, string>();
    const nodes: ApiNode[] = api.graph.nodes.map((node) => {
        const id = makeId("n");
        renamed.set(node.id, id);
        return {...node, id};
    });
    const links = api.graph.links.map((link) => ({
        id: makeId("lk"),
        from: {node: renamed.get(link.from.node) ?? link.from.node, pin: link.from.pin},
        to: {node: renamed.get(link.to.node) ?? link.to.node, pin: link.to.pin}
    }));

    const missingKinds = [...new Set(nodes.map((node) => node.kind).filter((kind) => !knownKinds.has(kind)))].sort();
    return {ok: true, cancelled: false, api: {...api, id: makeId("ap"), databaseId: "", graph: {nodes, links}}, missingKinds};
}
