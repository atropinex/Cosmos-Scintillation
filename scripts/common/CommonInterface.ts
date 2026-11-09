import type {GeneratedOutput} from "./exporters/ExportTypes";
import type {
    Capability, DbExporterId, EngineFamily, ExtensionKind, HttpMethod, LinkKind, LinkSource, NodeCapability, PinDirection,
    PinType, ProjectKind, PropertyType, PropValue, ReferenceAction, RelationKind, SaveState, ServiceCategory, ServiceKind,
    ServiceStatus, ThemeColor
} from "./projects/CosmosContract";

export type {SaveState, ServiceStatus};

// =============================================================================================== //
// === The project: what is saved in project.cosmos.yaml === //
// =============================================================================================== //

export interface CosmosProject {
    format: string;
    version: number;
    id: string;
    name: string;
    kind: ProjectKind;
    createdAt: string;
    updatedAt: string;
    databases: CosmosDatabase[];
    apis: CosmosApi[];
    links: CosmosLink[];
    export: {lastFolder: string};
}

// === Databases === //

export interface CosmosDatabase {
    id: string;
    name: string;
    /** The id of an engine, for example "postgresql" or "mongodb". */
    engine: string;
    tables: CosmosTable[];
}

/** A table, collection or key group. The engine's `terms` say which word the page uses. */
export interface CosmosTable {
    id: string;
    name: string;
    /** Where the table is drawn on the structure diagram. */
    x: number;
    y: number;
    columns: CosmosColumn[];
}

export interface CosmosColumn {
    id: string;
    name: string;
    /** The id of one of the engine's types, for example "varchar". */
    type: string;
    primary: boolean;
    unique: boolean;
    nullable: boolean;
    autoIncrement: boolean;
    /** Plain text. The exporters quote it, so SQL written here is not run as SQL. */
    default: string;
    /** A link to a column of another table: a foreign key, or a reference in NoSQL. */
    ref: ColumnRef | null;
}

export interface ColumnRef {
    tableId: string;
    columnId: string;
    onDelete: ReferenceAction;
}

/** One row (or document) of data. `_rid` is the row's own id inside the app. It is not a column. */
export type RowData = Record<string, string | number | boolean | null> & {_rid: string};

export interface RowPage {
    rows: RowData[];
    total: number;
    offset: number;
}

export interface RowResult {
    ok: boolean;
    error?: string;
    row?: RowData;
    removed?: number;
}

// === APIs made with visual scripting === //

export interface CosmosApi {
    id: string;
    name: string;
    /** The id of the language the script is exported to. */
    language: string;
    /** Ids of the optional packages of that language. */
    packages: string[];
    /** The database the data nodes use, or "". */
    databaseId: string;
    port: number;
    /** Starts with "/". Every route lives under it. */
    basePath: string;
    security: ApiSecurity;
    graph: ApiGraph;
}

/** The safe settings are the defaults. Loosening one shows a warning in the export dialog. */
export interface ApiSecurity {
    requireApiKey: boolean;
    /** Browser origins that may call the API. Empty means no cross-origin access. */
    allowedOrigins: string[];
    rateLimitPerMinute: number;
    maxBodyKb: number;
}

export interface ApiGraph {
    nodes: ApiNode[];
    links: ApiLink[];
}

export interface ApiNode {
    id: string;
    /** The id of a node definition, for example "route" or "dbFind". */
    kind: string;
    x: number;
    y: number;
    /**
     * The node's properties, by key. A value typed into an unconnected input pin is saved here too,
     * under the key "pin_<pinId>".
     */
    props: Record<string, PropValue>;
}

/** A wire from an output pin to an input pin. Exec wires carry the order of work, the others carry values. */
export interface ApiLink {
    id: string;
    from: {node: string; pin: string};
    to: {node: string; pin: string};
}

// === Links: the user's own APIs and sockets === //

export interface CosmosLink {
    id: string;
    name: string;
    kind: LinkKind;
    source: LinkSource;
    /** "https://api.example.com" or "wss://game.example.com/socket". */
    url: string;
    description: string;
    endpoints: LinkEndpoint[];
    auth: LinkAuth;
    headers: LinkHeader[];
}

export type LinkMethod = HttpMethod | "SEND" | "RECEIVE";

export interface LinkEndpoint {
    id: string;
    name: string;
    method: LinkMethod;
    /** The path after the URL, or a channel name for a socket. */
    path: string;
    description: string;
    /** An example request body or message, as text. */
    body: string;
}

export interface LinkAuth {
    type: "none" | "bearer" | "apiKey" | "basic";
    /** The header name for "apiKey". */
    name: string;
    /** Always an "enc:" text made by the main process, or empty. Never the plain secret. */
    secret: string;
}

export interface LinkHeader {
    key: string;
    value: string;
    enabled: boolean;
}

export interface LinkTestRequest {
    link: CosmosLink;
    method: HttpMethod;
    /** The path after the link's URL, or a full URL. */
    path: string;
    body: string;
}

export interface LinkTestResponse {
    ok: boolean;
    status: number;
    statusText: string;
    millis: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
    error: string;
}

export interface SocketEvent {
    /** The link id. */
    id: string;
    type: "open" | "message" | "close" | "error";
    text: string;
    at: number;
}

// =============================================================================================== //
// === Registries: YAML files the app reads. Extensions can add more. See docs/FORMATS.md. === //
// =============================================================================================== //

export interface EngineTerms {
    container: string;
    containers: string;
    row: string;
    rows: string;
    field: string;
    fields: string;
}

export interface EngineType {
    id: string;
    label: string;
}

/** How the "sql" exporter writes this engine. */
export interface SqlSettings {
    quote: string;
    autoIncrement: "none" | "serial" | "auto_increment" | "identity" | "autoincrement";
    tableSuffix: string;
    header: string;
    trueLiteral: string;
    falseLiteral: string;
}

export interface EngineDefinition {
    id: string;
    name: string;
    description: string;
    family: EngineFamily;
    exporter: DbExporterId;
    defaultPort: number;
    scriptExtension: string;
    terms: EngineTerms;
    relations: boolean;
    defaultType: string;
    keyType: string;
    types: EngineType[];
    sql: SqlSettings;
    /** "built-in" or the id of the extension that added it. */
    source: string;
}

export interface LanguagePackage {
    id: string;
    name: string;
    description: string;
}

/** What the page needs to know about a language. The templates stay in the main process. */
export interface LanguageSummary {
    id: string;
    name: string;
    description: string;
    capabilities: Capability[];
    runtime: string;
    runCommand: string;
    packages: LanguagePackage[];
    source: string;
}

export interface SelectOption {
    value: string;
    label: string;
}

export interface PinDefinition {
    id: string;
    name: string;
    direction: PinDirection;
    type: PinType;
    /** What an unconnected input pin uses. */
    default?: PropValue;
}

export interface NodePropDefinition {
    key: string;
    label: string;
    type: PropertyType;
    default: PropValue;
    options?: SelectOption[];
    hint?: string;
}

/** What the page needs to know about a node. The code templates stay in the main process. */
export interface NodeDefinition {
    id: string;
    name: string;
    category: string;
    description: string;
    /** A pure node has no exec pins and is written inline as an expression. */
    pure: boolean;
    capability: NodeCapability;
    pins: PinDefinition[];
    props: NodePropDefinition[];
    /** Ids of the languages that have a template for this node. */
    languages: string[];
    source: string;
}

export interface ServiceOptionDefinition {
    key: string;
    label: string;
    type: "text" | "number" | "folder";
    default: string;
}

export interface ServiceDefinition {
    id: string;
    name: string;
    description: string;
    category: ServiceCategory;
    kind: ServiceKind;
    defaultPort: number;
    /** Program names looked up on the PATH. */
    detect: string[];
    /** Where the user can get the program, shown when it is not found. */
    installHint: string;
    url: string;
    source: string;
}

export interface RegistryList {
    engines: EngineDefinition[];
    languages: LanguageSummary[];
    nodes: NodeDefinition[];
    services: ServiceDefinition[];
    /** Files that could not be read, as one readable line each. */
    problems: string[];
    folder: string;
}

// =============================================================================================== //
// === Export === //
// =============================================================================================== //

export interface SecurityFinding {
    level: "ok" | "warn" | "risk";
    message: string;
}

/** What the export dialog shows before anything is written. */
export interface ApiExportPreview extends GeneratedOutput {
    security: SecurityFinding[];
}

export interface ExportResult {
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    folder?: string;
    fileCount?: number;
}

export interface ScriptImportResult {
    ok: boolean;
    cancelled: boolean;
    error?: string;
    api?: CosmosApi;
    /** Node kinds in the file that no installed node knows. */
    missingKinds: string[];
}

export interface LinkImportResult {
    ok: boolean;
    cancelled: boolean;
    error?: string;
    link?: CosmosLink;
}

// =============================================================================================== //
// === Launcher: local services, like XAMPP === //
// =============================================================================================== //

export interface ServiceSettings {
    /** Full path of the program. Empty means "look for it on this computer". */
    path: string;
    port: number;
    /** The folder a static server shares. */
    root: string;
    autoStart: boolean;
}

export interface ServiceState {
    id: string;
    status: ServiceStatus;
    settings: ServiceSettings;
    /** The program that will run, or "" when none was found (or for built-in servers). */
    resolvedPath: string;
    pid: number;
    url: string;
    error: string;
    /** True for a service added by an extension. Starting it asks for confirmation. */
    needsConfirm: boolean;
}

// =============================================================================================== //
// === Extensions === //
// =============================================================================================== //

export interface ExtensionInfo {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    enabled: boolean;
    contributes: Partial<Record<ExtensionKind, number>>;
    folder: string;
    problems: string[];
}

export interface ExtensionList {
    extensions: ExtensionInfo[];
    folder: string;
}

// =============================================================================================== //
// === Settings, themes, keybinds === //
// =============================================================================================== //

export interface Settings {
    themeId: string;
    autosave: boolean;
    autosaveSeconds: number;
    snapToGrid: boolean;
    gridSize: number;
    rowsPerPage: number;
    showSidebar: boolean;
    projectsFolder: string;
    recentProjects: string[];
    disabledExtensions: string[];
    services: Record<string, ServiceSettings>;
}

export type ThemeColors = Record<ThemeColor, string>;

export interface Theme {
    id: string;
    name: string;
    author: string;
    mode: "dark" | "light";
    radius: number;
    motion: number;
    colors: ThemeColors;
}

export interface ThemeList {
    themes: Theme[];
    problems: string[];
    folder: string;
}

export interface KeybindAction {
    id: string;
    label: string;
    group: string;
    keys: string;
    defaultKeys: string;
}

export interface KeybindList {
    actions: KeybindAction[];
    file: string;
}

export interface MemoryInfo {
    totalMb: number;
    processes: Array<{name: string; pid: number; memoryMb: number}>;
}

// =============================================================================================== //
// === Projects on disk === //
// =============================================================================================== //

export interface ProjectFile {
    path: string;
    project: CosmosProject;
}

export interface RecentProject {
    path: string;
    name: string;
    kind: ProjectKind;
    exists: boolean;
    updatedAt: string;
    databaseCount: number;
    apiCount: number;
    /** A few names for the card's small preview. */
    preview: RecentPreview;
}

export interface RecentPreview {
    /** Up to 5 tables of the first database, with their column counts. */
    tables: {name: string; columns: number}[];
    /** Up to 3 names of APIs. */
    apis: string[];
    /** The links to the user's own APIs and sockets. */
    linkCount: number;
}

// === Tester: runs an API or a database against a safe copy of the project's data === //

export interface ApiTestRequest {
    method: string;
    /** The path including the API's base path, for example "/api/items/3". */
    path: string;
    /** Text after "?", for example "page=2&sort=name". */
    query: string;
    headers: Record<string, string>;
    body: unknown;
    /** Whether the request carries the API key. */
    sendKey: boolean;
}

export interface SocketTestRequest {
    event: string;
    data: unknown;
}

/** One node that ran, in order, with what it did. */
export interface TestStep {
    nodeId: string;
    label: string;
    note: string;
}

export interface TestResultBase {
    ok: boolean;
    steps: TestStep[];
    logs: string[];
    /** How many rows were added, changed or removed in the safe copy. */
    changes: number;
    ms: number;
    /** Things worth knowing, for example a node the tester cannot run. */
    notes: string[];
    error?: string;
}

export interface ApiTestResult extends TestResultBase {
    status: number;
    body: unknown;
    /** "GET /api/items/:id", or "" when no route matched. */
    route: string;
}

export interface SocketReply {
    event: string;
    data: unknown;
    to: "sender" | "others" | "all";
}

export interface SocketTestResult extends TestResultBase {
    replies: SocketReply[];
}

export type RowFilterOp = "eq" | "ne" | "lt" | "gt" | "contains" | "empty";

export interface RowQuery {
    tableId: string;
    columnId: string;
    op: RowFilterOp;
    value: string;
}

export interface RowQueryResult {
    ok: boolean;
    rows: RowData[];
    /** True when more rows matched than are shown. */
    more: boolean;
    scanned: number;
    error?: string;
}

export interface DatabaseCheckIssue {
    tableName: string;
    row: number;
    message: string;
}

export interface DatabaseCheckResult {
    ok: boolean;
    rowsChecked: number;
    issues: DatabaseCheckIssue[];
    /** True when more problems were found than are listed. */
    more: boolean;
}

export interface SaveResult {
    ok: boolean;
    error?: string;
    updatedAt?: string;
}

export type {PropertyType, RelationKind, LinkKind, LinkSource, NodeCapability, ProjectKind, ReferenceAction};

// =============================================================================================== //
// === The one door between the page and the main process === //
// =============================================================================================== //

export interface ElectronApi {
    // Projects
    listRecents(): Promise<RecentProject[]>;
    createProject(name: string, kind: ProjectKind, engineId: string): Promise<ProjectFile | null>;
    openProjectDialog(): Promise<ProjectFile | null>;
    openProject(path: string): Promise<ProjectFile | null>;
    saveProject(path: string, project: CosmosProject): Promise<SaveResult>;
    removeRecent(path: string): Promise<void>;
    revealPath(path: string): Promise<void>;

    // Table data. The page sends the whole database so the main process can check types without reading the project file.
    listRows(projectPath: string, databaseId: string, tableId: string, offset: number, limit: number): Promise<RowPage>;
    testApi(projectPath: string, api: CosmosApi, database: CosmosDatabase | null, request: ApiTestRequest): Promise<ApiTestResult>;
    testSocket(projectPath: string, api: CosmosApi, database: CosmosDatabase | null, request: SocketTestRequest): Promise<SocketTestResult>;
    resetTestData(projectPath: string): Promise<void>;
    queryRows(projectPath: string, database: CosmosDatabase, query: RowQuery): Promise<RowQueryResult>;
    checkRow(database: CosmosDatabase, tableId: string, values: Record<string, unknown>): Promise<{ok: boolean; message: string}>;
    checkDatabase(projectPath: string, database: CosmosDatabase): Promise<DatabaseCheckResult>;
    insertRow(projectPath: string, database: CosmosDatabase, tableId: string, values: Record<string, unknown>): Promise<RowResult>;
    updateRow(projectPath: string, database: CosmosDatabase, tableId: string, rowId: string, values: Record<string, unknown>): Promise<RowResult>;
    deleteRows(projectPath: string, databaseId: string, tableId: string, rowIds: string[]): Promise<RowResult>;
    /** Removes the saved rows of one table, or of a whole database when `tableId` is null. */
    deleteTableData(projectPath: string, databaseId: string, tableId: string | null): Promise<void>;

    // Registries
    listRegistries(): Promise<RegistryList>;
    reloadRegistries(): Promise<RegistryList>;
    restoreRegistries(): Promise<RegistryList>;
    openRegistryFolder(): Promise<void>;

    // Extensions
    listExtensions(): Promise<ExtensionList>;
    setExtensionEnabled(id: string, enabled: boolean): Promise<ExtensionList>;
    /** Asks for a folder that holds an extension.yaml and copies it into the extensions folder. */
    installExtension(): Promise<ExtensionList | null>;
    removeExtension(id: string): Promise<ExtensionList>;
    openExtensionsFolder(): Promise<void>;

    // Settings, themes, keybinds
    getSettings(): Promise<Settings>;
    patchSettings(changes: Partial<Settings>): Promise<Settings>;
    listThemes(): Promise<ThemeList>;
    openThemesFolder(): Promise<void>;
    listKeybinds(): Promise<KeybindList>;
    setKeybind(id: string, keys: string): Promise<KeybindList>;
    resetKeybinds(): Promise<KeybindList>;
    openConfigFolder(): Promise<void>;
    getMemory(): Promise<MemoryInfo>;

    // Export
    previewDatabaseExport(database: CosmosDatabase): Promise<GeneratedOutput>;
    writeDatabaseExport(database: CosmosDatabase, projectName: string, lastFolder: string): Promise<ExportResult>;
    previewApiExport(api: CosmosApi, database: CosmosDatabase | null, projectName: string): Promise<ApiExportPreview>;
    writeApiExport(api: CosmosApi, database: CosmosDatabase | null, projectName: string, lastFolder: string): Promise<ExportResult>;
    /** Saves the API as a .cosmos-script.yaml file, chosen with a save dialog. */
    exportScript(api: CosmosApi): Promise<ExportResult>;
    importScript(): Promise<ScriptImportResult>;

    // Links
    importLink(): Promise<LinkImportResult>;
    /** Turns a secret into the "enc:" text that is safe to save in the project file. */
    encryptSecret(plain: string): Promise<string>;
    sendRequest(request: LinkTestRequest): Promise<LinkTestResponse>;
    socketOpen(link: CosmosLink): Promise<void>;
    socketSend(linkId: string, text: string): Promise<void>;
    socketClose(linkId: string): Promise<void>;
    onSocketEvent(callback: (event: SocketEvent) => void): () => void;

    // Launcher
    listServices(): Promise<ServiceState[]>;
    startService(id: string, confirmed: boolean): Promise<ServiceState[]>;
    stopService(id: string): Promise<ServiceState[]>;
    patchService(id: string, changes: Partial<ServiceSettings>): Promise<ServiceState[]>;
    pickServiceBinary(id: string): Promise<ServiceState[]>;
    pickServiceFolder(id: string): Promise<ServiceState[]>;
    getServiceLogs(id: string): Promise<string[]>;
    onServiceChange(callback: (states: ServiceState[]) => void): () => void;

    // The window
    appReady(): Promise<void>;
    onFlushRequest(callback: () => void): () => void;
    flushDone(): Promise<void>;
    quitApp(): Promise<void>;
}
