import type {
    CosmosApi, CosmosColumn, CosmosDatabase, CosmosLink, CosmosProject, CosmosTable, EngineDefinition
} from "../CommonInterface";
import {
    DEFAULT_API_PORT, DEFAULT_MAX_BODY_KB, DEFAULT_RATE_LIMIT, PROJECT_FORMAT, PROJECT_VERSION
} from "../projects/CosmosConfig";
import type {LinkKind, LinkSource, ProjectKind} from "../projects/CosmosContract";
import {autoMode} from "./ColumnHelper";
import {makeId, toKebab} from "./IdHelper";

/** What a new API starts with. */
export type ApiPreset = "hello" | "crud" | "websocket";

export function createColumn(engine: EngineDefinition, name: string, overrides: Partial<CosmosColumn> = {}): CosmosColumn {
    return {
        id: makeId("cl"),
        name,
        type: engine.defaultType,
        primary: false,
        unique: false,
        nullable: true,
        autoIncrement: false,
        default: "",
        ref: null,
        ...overrides
    };
}

/** A new table starts with a primary key, so it is useful straight away. */
export function createTable(engine: EngineDefinition, name: string, x = 40, y = 40): CosmosTable {
    const key = createColumn(engine, engine.family === "document" ? "_id" : "id", {
        type: engine.keyType,
        primary: true,
        nullable: false,
        // A key that is not a number (a uuid) is created for every new row, so adding a row needs no typing.
        autoIncrement: autoMode(engine.keyType) === "id"
    });
    return {id: makeId("tb"), name, x, y, columns: [key]};
}

export function createDatabase(name: string, engine: EngineDefinition): CosmosDatabase {
    return {id: makeId("db"), name, engine: engine.id, tables: [createTable(engine, engine.family === "keyvalue" ? "session" : "items")]};
}

type Props = Record<string, string | number | boolean>;

/** Adds nodes and wires to a graph one flow at a time, so the presets below read like a list of steps. */
class GraphBuilder {
    readonly nodes: CosmosApi["graph"]["nodes"] = [];
    readonly links: CosmosApi["graph"]["links"] = [];

    /** `top` is the height of the first row, so new flows can start below blocks that are already there. */
    constructor(private readonly top = 60) {
    }

    add(kind: string, column: number, row: number, props: Props = {}): string {
        const id = makeId("n");
        this.nodes.push({id, kind, x: 80 + column * 340, y: this.top + row * 210, props});
        return id;
    }

    wire(from: string, fromPin: string, to: string, toPin: string): void {
        this.links.push({id: makeId("lk"), from: {node: from, pin: fromPin}, to: {node: to, pin: toPin}});
    }

    /** Wires "then" to "in" down a chain of nodes. */
    chain(...ids: string[]): void {
        for (let index = 0; index + 1 < ids.length; index++) {
            this.wire(ids[index], "then", ids[index + 1], "in");
        }
    }
}

/** One route per row of the screen: list, read one, create, change and delete for a table. */
function crudFlows(graph: GraphBuilder, table: CosmosTable): void {
    const base = "/" + toKebab(table.name, "items");
    const withId = `${base}/:id`;
    const t = {table: table.name};

    const list = graph.add("route", 0, 0, {method: "GET", path: base, public: false});
    const listFind = graph.add("dbFind", 1, 0, t);
    const listEnd = graph.add("respond", 2, 0, {pin_status: 200});
    graph.chain(list, listFind, listEnd);
    graph.wire(listFind, "rows", listEnd, "body");

    const one = graph.add("route", 0, 1, {method: "GET", path: withId, public: false});
    const oneId = graph.add("pathParam", 1, 1, {key: "id"});
    const oneFind = graph.add("dbFind", 2, 1, t);
    const oneEnd = graph.add("respond", 3, 1, {pin_status: 200});
    graph.chain(one, oneFind, oneEnd);
    graph.wire(oneId, "value", oneFind, "value");
    graph.wire(oneFind, "first", oneEnd, "body");

    const create = graph.add("route", 0, 2, {method: "POST", path: base, public: false});
    const createCheck = graph.add("validate", 1, 2, t);
    const createRow = graph.add("dbInsert", 2, 2, t);
    const createEnd = graph.add("respond", 3, 2, {pin_status: 201});
    graph.chain(create, createCheck, createRow, createEnd);
    graph.wire(createCheck, "clean", createRow, "values");
    graph.wire(createRow, "row", createEnd, "body");

    const change = graph.add("route", 0, 3, {method: "PUT", path: withId, public: false});
    const changeId = graph.add("pathParam", 1, 3, {key: "id"});
    const changeCheck = graph.add("validate", 1, 4, t);
    const changeRow = graph.add("dbUpdate", 2, 3, t);
    const changeEnd = graph.add("respond", 3, 3, {pin_status: 200});
    graph.chain(change, changeCheck, changeRow, changeEnd);
    graph.wire(changeId, "value", changeRow, "value");
    graph.wire(changeCheck, "clean", changeRow, "values");
    graph.wire(changeRow, "row", changeEnd, "body");

    const remove = graph.add("route", 0, 5, {method: "DELETE", path: withId, public: false});
    const removeId = graph.add("pathParam", 1, 5, {key: "id"});
    const removeRow = graph.add("dbDelete", 2, 5, t);
    const removeEnd = graph.add("respond", 3, 5, {pin_status: 204});
    graph.chain(remove, removeRow, removeEnd);
    graph.wire(removeId, "value", removeRow, "value");
}

/** The five routes of a table as blocks and wires, starting at height `top`. Added to an API by the editor. */
export function crudGraphFor(table: CosmosTable, top: number): CosmosApi["graph"] {
    const graph = new GraphBuilder(top);
    crudFlows(graph, table);
    return {nodes: graph.nodes, links: graph.links};
}

/** A small chat: "message" is sent to everyone, "ping" is answered to the sender only. */
function socketFlows(graph: GraphBuilder): void {
    const message = graph.add("wsEvent", 0, 0, {event: "message"});
    const text = graph.add("bodyField", 1, 0, {key: "text"});
    const share = graph.add("wsBroadcast", 2, 0, {event: "message", to: "all"});
    graph.chain(message, share);
    graph.wire(text, "value", share, "data");

    const ping = graph.add("wsEvent", 0, 1, {event: "ping"});
    const pong = graph.add("textValue", 1, 1, {pin_text: "pong"});
    const reply = graph.add("wsSend", 2, 1, {event: "pong"});
    graph.chain(ping, reply);
    graph.wire(pong, "value", reply, "data");
}

/**
 * A new API starts with working flows, so the canvas is never empty:
 * one hello route, the five routes of a table, or a small WebSocket chat.
 */
export function createApi(name: string, language: string, databaseId: string, preset: ApiPreset = "hello", table?: CosmosTable): CosmosApi {
    const graph = new GraphBuilder();
    if (preset === "crud" && table) {
        crudFlows(graph, table);
    } else if (preset === "websocket") {
        socketFlows(graph);
    } else {
        const route = graph.add("route", 0, 0, {method: "GET", path: "/hello", public: false});
        const respond = graph.add("respond", 1, 0, {pin_status: 200});
        graph.chain(route, respond);
    }

    return {
        id: makeId("ap"),
        name,
        language,
        packages: [],
        databaseId,
        port: DEFAULT_API_PORT,
        basePath: "/api",
        security: {requireApiKey: true, allowedOrigins: [], rateLimitPerMinute: DEFAULT_RATE_LIMIT, maxBodyKb: DEFAULT_MAX_BODY_KB},
        graph: {nodes: graph.nodes, links: graph.links}
    };
}

export function createLink(name: string, kind: LinkKind, source: LinkSource, url: string): CosmosLink {
    return {
        id: makeId("lk"), name, kind, source, url, description: "", endpoints: [],
        auth: {type: "none", name: "", secret: ""}, headers: []
    };
}

export function createProject(name: string, kind: ProjectKind, engine: EngineDefinition | null, defaultLanguage: string): CosmosProject {
    const now = new Date().toISOString();
    const databases = kind !== "api" && engine ? [createDatabase("main", engine)] : [];
    const apis = kind !== "database" ? [createApi("my-api", defaultLanguage, databases[0]?.id ?? "")] : [];

    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        id: makeId("pj"),
        name,
        kind,
        createdAt: now,
        updatedAt: now,
        databases,
        apis,
        links: [],
        export: {lastFolder: ""}
    };
}
