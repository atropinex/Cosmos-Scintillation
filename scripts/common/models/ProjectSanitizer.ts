import type {
    ApiGraph, ApiLink, ApiNode, ApiSecurity, ColumnRef, CosmosApi, CosmosColumn, CosmosDatabase, CosmosLink,
    CosmosProject, CosmosTable, LinkAuth, LinkEndpoint, LinkHeader, LinkMethod
} from "../CommonInterface";
import {
    DEFAULT_API_BASE_PATH, DEFAULT_API_PORT, DEFAULT_MAX_BODY_KB, DEFAULT_RATE_LIMIT, MAX_APIS, MAX_COLUMNS_PER_TABLE,
    MAX_COORDINATE, MAX_DATABASES, MAX_ENDPOINTS_PER_LINK, MAX_LINKS, MAX_NODES_PER_API, MAX_PORT, MAX_TABLES_PER_DATABASE,
    PROJECT_FORMAT, PROJECT_VERSION
} from "../projects/CosmosConfig";
import {
    HTTP_METHODS, LINK_KINDS, LINK_SOURCES, PROJECT_KINDS, REFERENCE_ACTIONS, type PropValue
} from "../projects/CosmosContract";
import {isOneOf, isRecord, round, toBoolean, toNumber, toText} from "../utils/GuardHelper";
import {makeId} from "../utils/IdHelper";

const ID_PATTERN = /^[a-z0-9_]{1,64}$/i;
const PROP_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const LINK_METHODS: readonly string[] = [...HTTP_METHODS, "SEND", "RECEIVE"];

/** Hands out ids: keeps a valid unique id as it is and replaces a missing, odd or repeated one. */
class IdBook {
    private readonly used = new Set<string>();
    /** Old id -> id in the result, so references can follow a renamed id. */
    readonly map = new Map<string, string>();

    constructor(private readonly prefix: string) {
    }

    take(value: unknown): string {
        let id = typeof value === "string" && ID_PATTERN.test(value) && !this.used.has(value) ? value : "";
        while (!id || this.used.has(id)) {
            id = makeId(this.prefix);
        }
        this.used.add(id);
        if (typeof value === "string") {
            this.map.set(value, id);
        }
        return id;
    }
}

const list = (value: unknown, limit: number): unknown[] => (Array.isArray(value) ? value.slice(0, limit) : []);
const coordinate = (value: unknown, fallback = 0) => round(toNumber(value, fallback, -MAX_COORDINATE, MAX_COORDINATE), 1);

// === Databases === //

function sanitizeTable(raw: unknown, tableIds: IdBook, defaultY: number): {table: CosmosTable; columnIds: IdBook; rawColumns: unknown[]} | null {
    if (!isRecord(raw)) {
        return null;
    }

    const columnIds = new IdBook("cl");
    const rawColumns = list(raw.columns, MAX_COLUMNS_PER_TABLE);
    const columns: CosmosColumn[] = [];

    for (const item of rawColumns) {
        if (!isRecord(item)) {
            continue;
        }
        columns.push({
            id: columnIds.take(item.id),
            name: toText(item.name, "column", 80).trim() || "column",
            type: toText(item.type, "text", 60),
            primary: toBoolean(item.primary, false),
            unique: toBoolean(item.unique, false),
            nullable: toBoolean(item.nullable, true),
            autoIncrement: toBoolean(item.autoIncrement, false),
            default: toText(item.default, "", 200),
            ref: null // filled in once all tables are known
        });
    }

    const table: CosmosTable = {
        id: tableIds.take(raw.id),
        name: toText(raw.name, "table", 80).trim() || "table",
        x: coordinate(raw.x, 40),
        y: coordinate(raw.y, defaultY),
        columns
    };
    return {table, columnIds, rawColumns: rawColumns.filter(isRecord)};
}

export function sanitizeDatabase(raw: unknown, databaseIds = new IdBook("db")): CosmosDatabase | null {
    if (!isRecord(raw)) {
        return null;
    }

    const tableIds = new IdBook("tb");
    const parsed: Array<{table: CosmosTable; columnIds: IdBook; rawColumns: unknown[]}> = [];
    for (const item of list(raw.tables, MAX_TABLES_PER_DATABASE)) {
        const result = sanitizeTable(item, tableIds, 40 + parsed.length * 30);
        if (result) {
            parsed.push(result);
        }
    }

    // References: follow renamed ids and drop the ones that point at nothing.
    const byId = new Map(parsed.map((entry) => [entry.table.id, entry]));
    for (const entry of parsed) {
        entry.rawColumns.forEach((rawColumn, index) => {
            const source = isRecord(rawColumn) && isRecord(rawColumn.ref) ? rawColumn.ref : null;
            const column = entry.table.columns[index];
            if (!source || !column) {
                return;
            }

            const tableId = tableIds.map.get(String(source.tableId));
            const target = tableId ? byId.get(tableId) : undefined;
            const columnId = target?.columnIds.map.get(String(source.columnId));
            if (tableId && columnId && target?.table.columns.some((item) => item.id === columnId)) {
                const ref: ColumnRef = {
                    tableId,
                    columnId,
                    onDelete: isOneOf(REFERENCE_ACTIONS, source.onDelete) ? source.onDelete : "no action"
                };
                column.ref = ref;
            }
        });
    }

    return {
        id: databaseIds.take(raw.id),
        name: toText(raw.name, "main", 60).trim() || "main",
        engine: toText(raw.engine, "postgresql", 60),
        tables: parsed.map((entry) => entry.table)
    };
}

// === APIs === //

function sanitizeProps(raw: unknown): Record<string, PropValue> {
    const props: Record<string, PropValue> = {};
    if (!isRecord(raw)) {
        return props;
    }

    for (const [key, value] of Object.entries(raw).slice(0, 64)) {
        if (!PROP_KEY_PATTERN.test(key)) {
            continue;
        }
        if (typeof value === "string") {
            props[key] = value.slice(0, 2000);
        } else if (typeof value === "number" && Number.isFinite(value)) {
            props[key] = value;
        } else if (typeof value === "boolean") {
            props[key] = value;
        }
    }
    return props;
}

function sanitizeSecurity(raw: unknown): ApiSecurity {
    const data = isRecord(raw) ? raw : {};
    const origins = list(data.allowedOrigins, 50)
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 200))
        .filter(Boolean);

    return {
        requireApiKey: toBoolean(data.requireApiKey, true),
        allowedOrigins: origins,
        rateLimitPerMinute: Math.round(toNumber(data.rateLimitPerMinute, DEFAULT_RATE_LIMIT, 1, 100000)),
        maxBodyKb: Math.round(toNumber(data.maxBodyKb, DEFAULT_MAX_BODY_KB, 1, 102400))
    };
}

function sanitizeGraph(raw: unknown): ApiGraph {
    const data = isRecord(raw) ? raw : {};
    const nodeIds = new IdBook("n");
    const nodes: ApiNode[] = [];

    for (const item of list(data.nodes, MAX_NODES_PER_API)) {
        if (!isRecord(item) || typeof item.kind !== "string" || !/^[A-Za-z0-9_.-]{1,60}$/.test(item.kind)) {
            continue;
        }
        nodes.push({
            id: nodeIds.take(item.id),
            kind: item.kind,
            x: coordinate(item.x),
            y: coordinate(item.y),
            props: sanitizeProps(item.props)
        });
    }

    const known = new Set(nodes.map((node) => node.id));
    const linkIds = new IdBook("lk");
    const links: ApiLink[] = [];
    const pin = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(value) ? value : null);

    for (const item of list(data.links, MAX_NODES_PER_API * 4)) {
        if (!isRecord(item) || !isRecord(item.from) || !isRecord(item.to)) {
            continue;
        }
        const fromNode = nodeIds.map.get(String(item.from.node));
        const toNode = nodeIds.map.get(String(item.to.node));
        const fromPin = pin(item.from.pin);
        const toPin = pin(item.to.pin);
        if (!fromNode || !toNode || !fromPin || !toPin || !known.has(fromNode) || !known.has(toNode) || fromNode === toNode) {
            continue;
        }
        links.push({id: linkIds.take(item.id), from: {node: fromNode, pin: fromPin}, to: {node: toNode, pin: toPin}});
    }
    return {nodes, links};
}

export function sanitizeApi(raw: unknown, apiIds = new IdBook("ap")): CosmosApi | null {
    if (!isRecord(raw)) {
        return null;
    }

    let basePath = toText(raw.basePath, DEFAULT_API_BASE_PATH, 100).trim();
    if (!/^\/[A-Za-z0-9/_-]*$/.test(basePath)) {
        basePath = DEFAULT_API_BASE_PATH;
    }
    basePath = basePath.length > 1 ? basePath.replace(/\/+$/, "") : basePath;

    return {
        id: apiIds.take(raw.id),
        name: toText(raw.name, "my-api", 60).trim() || "my-api",
        language: toText(raw.language, "", 60),
        packages: list(raw.packages, 50).filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 60)),
        databaseId: toText(raw.databaseId, "", 64),
        port: Math.round(toNumber(raw.port, DEFAULT_API_PORT, 1, MAX_PORT)),
        basePath,
        security: sanitizeSecurity(raw.security),
        graph: sanitizeGraph(raw.graph)
    };
}

// === Links === //

function sanitizeAuth(raw: unknown): LinkAuth {
    const data = isRecord(raw) ? raw : {};
    const type = isOneOf(["none", "bearer", "apiKey", "basic"] as const, data.type) ? data.type : "none";
    // A secret is only ever kept in its encrypted form. Anything else is dropped rather than saved as plain text.
    const secret = typeof data.secret === "string" && data.secret.startsWith("enc:v1:") ? data.secret.slice(0, 4000) : "";
    return {type, name: toText(data.name, "", 100), secret};
}

function sanitizeEndpoint(raw: unknown, ids: IdBook): LinkEndpoint | null {
    if (!isRecord(raw)) {
        return null;
    }
    const method = typeof raw.method === "string" && LINK_METHODS.includes(raw.method) ? (raw.method as LinkMethod) : "GET";
    return {
        id: ids.take(raw.id),
        name: toText(raw.name, "endpoint", 120),
        method,
        path: toText(raw.path, "/", 500),
        description: toText(raw.description, "", 1000),
        body: toText(raw.body, "", 20000)
    };
}

export function sanitizeLink(raw: unknown, linkIds = new IdBook("lk")): CosmosLink | null {
    if (!isRecord(raw)) {
        return null;
    }

    const endpointIds = new IdBook("ep");
    const headers: LinkHeader[] = [];
    for (const item of list(raw.headers, 40)) {
        if (isRecord(item) && typeof item.key === "string" && item.key.trim()) {
            headers.push({key: item.key.trim().slice(0, 100), value: toText(item.value, "", 2000), enabled: toBoolean(item.enabled, true)});
        }
    }

    return {
        id: linkIds.take(raw.id),
        name: toText(raw.name, "connection", 80).trim() || "connection",
        kind: isOneOf(LINK_KINDS, raw.kind) ? raw.kind : "rest",
        source: isOneOf(LINK_SOURCES, raw.source) ? raw.source : "manual",
        url: toText(raw.url, "", 500),
        description: toText(raw.description, "", 2000),
        endpoints: list(raw.endpoints, MAX_ENDPOINTS_PER_LINK)
            .map((item) => sanitizeEndpoint(item, endpointIds))
            .filter((item): item is LinkEndpoint => item !== null),
        auth: sanitizeAuth(raw.auth),
        headers
    };
}

// === The project === //

/** Checks anything that claims to be a project (from a file or from the page). Null when it is not one. */
export function sanitizeProject(raw: unknown, fallbackName = "Untitled"): CosmosProject | null {
    if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
        return null;
    }

    const now = new Date().toISOString();
    const databaseIds = new IdBook("db");
    const apiIds = new IdBook("ap");
    const linkIds = new IdBook("lk");

    const collect = <T>(items: unknown, limit: number, make: (item: unknown) => T | null): T[] => {
        return list(items, limit).map(make).filter((item): item is T => item !== null);
    };

    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        id: new IdBook("pj").take(raw.id),
        name: toText(raw.name, fallbackName, 80).trim() || fallbackName,
        kind: isOneOf(PROJECT_KINDS, raw.kind) ? raw.kind : "both",
        createdAt: toText(raw.createdAt, now, 40),
        updatedAt: toText(raw.updatedAt, now, 40),
        databases: collect(raw.databases, MAX_DATABASES, (item) => sanitizeDatabase(item, databaseIds)),
        apis: collect(raw.apis, MAX_APIS, (item) => sanitizeApi(item, apiIds)),
        links: collect(raw.links, MAX_LINKS, (item) => sanitizeLink(item, linkIds)),
        export: {lastFolder: toText(isRecord(raw.export) ? raw.export.lastFolder : "", "", 1000)}
    };
}

export {ID_PATTERN as SAFE_ID_PATTERN};
