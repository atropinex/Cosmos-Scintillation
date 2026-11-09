import type {NodeDefinition, LanguageSummary} from "../CommonInterface";

// === What the YAML files turn into. Only the main process and the tests see these. === //

export type StringStyle = "default" | "ruby" | "rust";

export interface Dependency {
    name: string;
    version: string;
    dev: boolean;
    /** "websocket" = only when the API has WebSocket nodes. */
    when: string;
}

export interface PackageSpec {
    id: string;
    name: string;
    description: string;
    dependencies: Dependency[];
    imports: string[];
    setup: string[];
}

export interface FileTemplate {
    path: string;
    template: string;
    when: string;
}

/** A language file, fully parsed. `summary` is the part the page sees. */
export interface LanguageSpec {
    id: string;
    summary: LanguageSummary;
    stringStyle: StringStyle;
    indent: string;
    literals: {null: string; true: string; false: string; object: string; list: string};
    /** How a plain string, number or boolean becomes a *value* in the language. "{{v}}" is the literal. */
    wrap: {string: string; number: string; boolean: string};
    /** How a pure node's shared value is stored in a variable: "const {{name}} = {{expr}};". */
    declare: string;
    /** Added after a node that declares an output nobody uses, for languages that reject unused variables. */
    usedMarker: string;
    dependencies: Dependency[];
    dependencyFormat: string;
    devDependencyFormat: string;
    dependencySeparator: string;
    packages: PackageSpec[];
    wsImports: string[];
    wsSetup: string;
    files: FileTemplate[];
}

/** A node definition plus its code. Templates are keyed by language id. */
export interface NodeSpec extends NodeDefinition {
    templates: Record<string, string>;
}

export interface RouteInfo {
    nodeId: string;
    method: string;
    /** Path with the base path, colon style. */
    path: string;
    isPublic: boolean;
    /** Kinds of every node that can run on the way, for the security analysis. */
    kinds: string[];
    /** Kinds that run on the way before a "validate". Used to see whether input is checked before a write. */
    writesBeforeValidate: boolean;
}

export interface CompileResult {
    routes: string;
    wsHandlers: string;
    routeInfos: RouteInfo[];
    wsEvents: string[];
    errors: string[];
    warnings: string[];
}

export interface BuildRegistry {
    languages: LanguageSpec[];
    nodes: NodeSpec[];
    engines: import("../CommonInterface").EngineDefinition[];
}
