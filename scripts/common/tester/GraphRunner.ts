import type {
    ApiNode, ApiTestRequest, CosmosApi, CosmosDatabase, CosmosTable, NodeDefinition, RowData, SocketReply, SocketTestRequest, TestStep
} from "../CommonInterface";
import {checkRequired, coerceRow, findClash} from "../models/RowStoreModel";
import type {PropValue} from "../projects/CosmosContract";
import {autoMode, newAutoId} from "../utils/ColumnHelper";
import {isRecord} from "../utils/GuardHelper";
import {makeId} from "../utils/IdHelper";

// === Runs a visual script for one request, without writing code or files === //
// The tester reads the same graph the exporter turns into code, but it executes it here, on a copy of the
// project's rows (the "sandbox"). Real data is never touched. Only the built-in nodes can run; a node that comes
// from an extension is reported and skipped.

type Value = unknown;

/** The rows of every table of one database, by table id. Changes stay in here. */
export type Sandbox = Map<string, RowData[]>;

/** How many steps one run may take, so a wrong wire cannot make the tester spin. */
const MAX_STEPS = 500;
const MAX_FIND_ROWS = 1000;

export interface RunContext {
    api: CosmosApi;
    database: CosmosDatabase | null;
    definitions: Map<string, NodeDefinition>;
    sandbox: Sandbox;
}

/** What a run produced. The API and the socket results are made from it. */
export interface RunOutcome {
    status: number;
    body: unknown;
    replies: SocketReply[];
    steps: TestStep[];
    logs: string[];
    notes: string[];
    changes: number;
    error?: string;
}

class Stop extends Error {
    constructor(readonly status: number, readonly payload: unknown) {
        super("stop");
    }
}

// === Small value helpers === //

const isEmpty = (value: Value) => value === null || value === undefined || value === "";

function truthy(value: Value): boolean {
    if (typeof value === "string") {
        return !["", "0", "false", "no"].includes(value.trim().toLowerCase());
    }
    return Boolean(value);
}

function asNumber(value: Value): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}

const asText = (value: Value): string => (isEmpty(value) ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

function describe(value: Value): string {
    const text = asText(value).replace(/\s+/g, " ");
    return text.length > 60 ? `${text.slice(0, 57)}...` : JSON.stringify(text);
}

function compare(op: string, a: Value, b: Value): boolean {
    const x = asNumber(a);
    const y = asNumber(b);
    const numeric = x !== null && y !== null;
    const left = asText(a);
    const right = asText(b);

    switch (op) {
        case "eq": return numeric ? x === y : left === right;
        case "ne": return numeric ? x !== y : left !== right;
        case "lt": return numeric ? x < y : left < right;
        case "le": return numeric ? x <= y : left <= right;
        case "gt": return numeric ? x > y : left > right;
        case "ge": return numeric ? x >= y : left >= right;
        case "contains": return left.includes(right);
        case "starts": return left.startsWith(right);
        case "ends": return left.endsWith(right);
        default: return false;
    }
}

function calculate(op: string, a: Value, b: Value): number | null {
    const x = asNumber(a);
    const y = asNumber(b);
    if (x === null || y === null) {
        return null;
    }
    switch (op) {
        case "add": return x + y;
        case "sub": return x - y;
        case "mul": return x * y;
        case "div": return y === 0 ? null : x / y;
        case "mod": return y === 0 ? null : x % y;
        case "min": return Math.min(x, y);
        case "max": return Math.max(x, y);
        default: return null;
    }
}

/** A row as the API shows it: column names as keys, no internal id. */
function toJson(table: CosmosTable, row: RowData): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const column of table.columns) {
        result[column.name] = row[column.id] ?? null;
    }
    return result;
}

function findTable(database: CosmosDatabase | null, key: string): CosmosTable | null {
    return database?.tables.find((table) => table.id === key || table.name === key) ?? null;
}

// === The run === //

class Run {
    readonly steps: TestStep[] = [];
    readonly logs: string[] = [];
    readonly notes: string[] = [];
    readonly replies: SocketReply[] = [];
    changes = 0;
    status = 200;
    body: unknown = null;
    answered = false;

    private readonly nodes: Map<string, ApiNode>;
    /** The wire that feeds an input pin: "node|pin" -> the output it comes from. */
    private readonly sources = new Map<string, {node: string; pin: string}>();
    /** The node an exec output continues with: "node|pin" -> next node. */
    private readonly next = new Map<string, string>();
    /** Values the nodes that ran have produced, "node|pin". */
    private readonly outputs = new Map<string, Value>();
    private stepCount = 0;

    constructor(
        private readonly context: RunContext,
        private readonly input: {params: Record<string, string>; query: Record<string, string>; headers: Record<string, string>; body: unknown}
    ) {
        this.nodes = new Map(context.api.graph.nodes.map((node) => [node.id, node]));
        for (const link of context.api.graph.links) {
            const target = this.nodes.get(link.to.node);
            const definition = target ? context.definitions.get(target.kind) : undefined;
            const pin = definition?.pins.find((item) => item.id === link.to.pin);
            if (pin?.type === "exec") {
                this.next.set(`${link.from.node}|${link.from.pin}`, link.to.node);
            } else {
                this.sources.set(`${link.to.node}|${link.to.pin}`, link.from);
            }
        }
    }

    // --- Reading inputs --- //

    private prop(node: ApiNode, key: string, fallback: PropValue = ""): PropValue {
        const definition = this.context.definitions.get(node.kind)?.props.find((item) => item.key === key);
        return node.props[key] ?? definition?.default ?? fallback;
    }

    private pinValue(node: ApiNode, pinId: string): Value {
        const source = this.sources.get(`${node.id}|${pinId}`);
        if (source) {
            return this.output(source.node, source.pin);
        }
        const typed = node.props[`pin_${pinId}`];
        if (typed !== undefined) {
            return typed;
        }
        return this.context.definitions.get(node.kind)?.pins.find((item) => item.id === pinId)?.default ?? null;
    }

    private output(nodeId: string, pinId: string): Value {
        const node = this.nodes.get(nodeId);
        const definition = node ? this.context.definitions.get(node.kind) : undefined;
        if (!node || !definition) {
            return null;
        }
        if (definition.pure) {
            return this.pure(node, pinId);
        }
        return this.outputs.get(`${nodeId}|${pinId}`) ?? null;
    }

    private tableOf(node: ApiNode): CosmosTable | null {
        const key = String(this.prop(node, "table", ""));
        const table = findTable(this.context.database, key);
        if (!table) {
            throw new Stop(500, {error: this.context.database
                ? `The table "${key}" does not exist in the database "${this.context.database.name}".`
                : "This API has no database. Choose one in the API settings."});
        }
        return table;
    }

    /** Pure nodes are worked out when something reads them, the same way the exporter writes them inline. */
    private pure(node: ApiNode, _pin: string): Value {
        const a = () => this.pinValue(node, "a");
        const b = () => this.pinValue(node, "b");
        const text = (key: string) => String(this.prop(node, key, ""));

        switch (node.kind) {
            case "bodyField": return isRecord(this.input.body) ? this.input.body[text("key")] ?? "" : "";
            case "queryParam": return this.input.query[text("key")] ?? "";
            case "pathParam": return this.input.params[text("key")] ?? "";
            case "headerValue": return this.input.headers[text("key").toLowerCase()] ?? "";
            case "textValue": return this.pinValue(node, "text") ?? "";
            case "numberValue": return asNumber(this.pinValue(node, "number")) ?? 0;
            case "boolValue": return truthy(this.pinValue(node, "flag"));
            case "compare": return compare(text("op"), a(), b());
            case "logicOp": {
                const op = text("op");
                return op === "not" ? !truthy(a()) : op === "or" ? truthy(a()) || truthy(b()) : truthy(a()) && truthy(b());
            }
            case "textJoin": return `${asText(a())}${text("separator")}${asText(b())}`;
            case "textTransform": {
                const value = asText(this.pinValue(node, "text"));
                const op = text("op");
                return op === "upper" ? value.toUpperCase() : op === "lower" ? value.toLowerCase() : op === "length" ? value.length : value.trim();
            }
            case "mathOp": return calculate(text("op"), a(), b());
            case "now": return new Date().toISOString();
            case "newId": return makeId("t");
            case "makeObject": {
                const result: Record<string, unknown> = {};
                for (const letter of ["A", "B", "C"]) {
                    const name = text(`key${letter}`);
                    if (name) {
                        result[name] = this.pinValue(node, letter.toLowerCase());
                    }
                }
                return result;
            }
            case "getField": {
                const object = this.pinValue(node, "object");
                return isRecord(object) ? object[text("key")] ?? null : null;
            }
            default:
                this.notes.push(`The node "${this.context.definitions.get(node.kind)?.name ?? node.kind}" comes from an extension, so the tester gave it an empty value.`);
                return null;
        }
    }

    // --- Running the flow --- //

    private step(node: ApiNode, note: string): void {
        if (++this.stepCount > MAX_STEPS) {
            throw new Stop(500, {error: `The flow ran more than ${MAX_STEPS} steps. Check for a wire that goes back to an earlier node.`});
        }
        this.steps.push({nodeId: node.id, label: this.context.definitions.get(node.kind)?.name ?? node.kind, note});
    }

    /** Runs the flow that starts at an entry node (a route or a WebSocket event). */
    start(entry: ApiNode): void {
        this.step(entry, "Started");
        let current = this.next.get(`${entry.id}|then`);
        try {
            while (current && !this.answered) {
                const node = this.nodes.get(current);
                if (!node) {
                    break;
                }
                current = this.execute(node);
            }
        } catch (error) {
            if (!(error instanceof Stop)) {
                throw error;
            }
            this.status = error.status;
            this.body = error.payload;
            this.answered = true;
        }
    }

    /** Runs one node and returns the id of the node that follows. */
    private execute(node: ApiNode): string | undefined {
        const out = (pin: string) => this.next.get(`${node.id}|${pin}`);
        const set = (pin: string, value: Value) => this.outputs.set(`${node.id}|${pin}`, value);
        const text = (key: string) => String(this.prop(node, key, ""));

        switch (node.kind) {
            case "respond": {
                this.status = Math.round(asNumber(this.pinValue(node, "status")) ?? 200);
                this.body = this.status === 204 ? null : this.pinValue(node, "body");
                this.answered = true;
                this.step(node, `Answered ${this.status}`);
                return undefined;
            }
            case "log": {
                const line = asText(this.pinValue(node, "message")).replace(/[\r\n]+/g, " ").slice(0, 500);
                this.logs.push(`[${text("level") || "info"}] ${line}`);
                this.step(node, `Logged ${describe(line)}`);
                return out("then");
            }
            case "branch": {
                const yes = truthy(this.pinValue(node, "condition"));
                this.step(node, yes ? "Condition is yes" : "Condition is no");
                return out(yes ? "true" : "false");
            }
            case "validate": return this.validate(node, out, set);
            case "dbFind": return this.find(node, out, set);
            case "dbInsert": return this.insert(node, out, set);
            case "dbUpdate": return this.update(node, out, set);
            case "dbDelete": return this.remove(node, out, set);
            case "wsSend":
            case "wsBroadcast": {
                const to = node.kind === "wsSend" ? "sender" : (text("to") === "all" ? "all" : "others");
                const event = text("event") || (node.kind === "wsSend" ? "reply" : "broadcast");
                this.replies.push({event, data: this.pinValue(node, "data"), to});
                this.step(node, `Sent "${event}" to ${to === "sender" ? "the sender" : to === "all" ? "everyone" : "everyone else"}`);
                return out("then");
            }
            default: {
                this.notes.push(`The node "${this.context.definitions.get(node.kind)?.name ?? node.kind}" comes from an extension. The tester skipped it and stopped here.`);
                this.step(node, "Skipped (not supported by the tester)");
                return undefined;
            }
        }
    }

    // --- Data nodes --- //

    private rowsOf(table: CosmosTable): RowData[] {
        let rows = this.context.sandbox.get(table.id);
        if (!rows) {
            rows = [];
            this.context.sandbox.set(table.id, rows);
        }
        return rows;
    }

    /** The column a node matches on: the one it names, or the primary key, or the first column. */
    private matchColumn(node: ApiNode, table: CosmosTable) {
        const name = String(this.prop(node, "column", ""));
        return table.columns.find((column) => column.name === name || column.id === name)
            ?? table.columns.find((column) => column.primary)
            ?? table.columns[0];
    }

    private matching(node: ApiNode, table: CosmosTable, value: Value): RowData[] {
        const rows = this.rowsOf(table);
        const column = this.matchColumn(node, table);
        if (!column || isEmpty(value)) {
            return isEmpty(value) ? rows : [];
        }
        return rows.filter((row) => compare("eq", row[column.id], value));
    }

    private find(node: ApiNode, out: (pin: string) => string | undefined, set: (pin: string, value: Value) => void): string | undefined {
        const table = this.tableOf(node)!;
        const rows = this.matching(node, table, this.pinValue(node, "value")).slice(0, MAX_FIND_ROWS).map((row) => toJson(table, row));
        set("rows", rows);
        set("first", rows[0] ?? null);
        this.step(node, `Found ${rows.length} row${rows.length === 1 ? "" : "s"} in "${table.name}"`);
        return out("then");
    }

    private applyDefaults(table: CosmosTable, values: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {...values};
        for (const column of table.columns) {
            const given = result[column.name] ?? result[column.id];
            if (isEmpty(given) && column.default !== "" && !column.autoIncrement) {
                result[column.name] = column.default;
                delete result[column.id];
            }
        }
        return result;
    }

    private insert(node: ApiNode, out: (pin: string) => string | undefined, set: (pin: string, value: Value) => void): string | undefined {
        const table = this.tableOf(node)!;
        const values = this.pinValue(node, "values");
        const checked = coerceRow(table.columns, isRecord(values) ? this.applyDefaults(table, values) : values, true);
        if (typeof checked === "string") {
            throw new Stop(400, {error: checked});
        }

        const rows = this.rowsOf(table);
        const keyed = table.columns.filter((column) => column.primary || column.unique);
        for (const row of rows) {
            const clash = findClash(keyed, checked, row);
            if (clash) {
                throw new Stop(409, {error: clash});
            }
        }
        for (const column of table.columns.filter((item) => item.autoIncrement)) {
            if (checked[column.id] === null || checked[column.id] === undefined || checked[column.id] === "") {
                if (autoMode(column.type) === "id") {
                    checked[column.id] = newAutoId(column.type);
                    continue;
                }
                const biggest = rows.reduce((max, row) => Math.max(max, typeof row[column.id] === "number" ? Number(row[column.id]) : 0), 0);
                checked[column.id] = biggest + 1;
            }
        }
        const problem = checkRequired(table.columns, checked);
        if (problem) {
            throw new Stop(400, {error: problem});
        }

        const row: RowData = {_rid: makeId("r"), ...checked};
        rows.push(row);
        this.changes++;
        set("row", toJson(table, row));
        this.step(node, `Added a row to "${table.name}"`);
        return out("then");
    }

    private update(node: ApiNode, out: (pin: string) => string | undefined, set: (pin: string, value: Value) => void): string | undefined {
        const table = this.tableOf(node)!;
        const targets = isEmpty(this.pinValue(node, "value")) ? [] : this.matching(node, table, this.pinValue(node, "value"));
        const values = this.pinValue(node, "values");
        const checked = coerceRow(table.columns, values, false);
        if (typeof checked === "string") {
            throw new Stop(400, {error: checked});
        }
        for (const column of table.columns.filter((item) => item.primary)) {
            delete checked[column.id];
        }

        const keyed = table.columns.filter((column) => column.unique && column.id in checked);
        for (const row of this.rowsOf(table)) {
            if (!targets.includes(row)) {
                const clash = findClash(keyed, checked, row);
                if (clash) {
                    throw new Stop(409, {error: clash});
                }
            }
        }
        for (const row of targets) {
            Object.assign(row, checked);
        }
        this.changes += targets.length;
        set("row", targets[0] ? toJson(table, targets[0]) : null);
        set("count", targets.length);
        this.step(node, `Changed ${targets.length} row${targets.length === 1 ? "" : "s"} of "${table.name}"`);
        return out("then");
    }

    private remove(node: ApiNode, out: (pin: string) => string | undefined, set: (pin: string, value: Value) => void): string | undefined {
        const table = this.tableOf(node)!;
        const value = this.pinValue(node, "value");
        const targets = isEmpty(value) ? [] : this.matching(node, table, value);
        const rows = this.rowsOf(table);
        this.context.sandbox.set(table.id, rows.filter((row) => !targets.includes(row)));
        this.changes += targets.length;
        set("count", targets.length);
        this.step(node, `Removed ${targets.length} row${targets.length === 1 ? "" : "s"} from "${table.name}"`);
        return out("then");
    }

    private validate(node: ApiNode, out: (pin: string) => string | undefined, set: (pin: string, value: Value) => void): string | undefined {
        const table = this.tableOf(node)!;
        const wired = this.sources.has(`${node.id}|data`);
        const data = wired ? this.pinValue(node, "data") : this.input.body;
        const partial = String(this.prop(node, "mode", "full")) === "partial";

        // Fields that are not columns are dropped, as the exported code does.
        const known = new Set(table.columns.flatMap((column) => [column.name, column.id]));
        const source = isRecord(data) ? Object.fromEntries(Object.entries(data).filter(([key]) => known.has(key))) : data;
        const withDefaults = isRecord(source) && !partial ? this.applyDefaults(table, source) : source;
        const checked = coerceRow(table.columns, withDefaults, !partial);
        if (typeof checked === "string") {
            this.step(node, `Rejected: ${checked}`);
            throw new Stop(400, {error: checked});
        }
        if (!partial) {
            const problem = checkRequired(table.columns.filter((column) => !column.autoIncrement), checked);
            if (problem) {
                this.step(node, `Rejected: ${problem}`);
                throw new Stop(400, {error: problem});
            }
        }

        const clean: Record<string, unknown> = {};
        for (const column of table.columns) {
            if (column.id in checked && !(partial && checked[column.id] === null && !(isRecord(source) && column.name in source))) {
                clean[column.name] = checked[column.id];
            }
        }
        set("clean", clean);
        this.step(node, "Data is valid");
        return out("then");
    }
}

// === Entry points === //

function parseQuery(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(text.replace(/^\?/, ""))) {
        result[key] = value;
    }
    return result;
}

/** "/api/items/:id" against "/api/items/3": the :name parts, or null when the path does not fit. */
function matchPath(pattern: string, path: string): Record<string, string> | null {
    const want = pattern.split("/").filter(Boolean);
    const have = path.split("/").filter(Boolean);
    if (want.length !== have.length) {
        return null;
    }
    const params: Record<string, string> = {};
    for (let index = 0; index < want.length; index++) {
        if (want[index].startsWith(":")) {
            try {
                params[want[index].slice(1)] = decodeURIComponent(have[index]);
            } catch {
                return null;
            }
        } else if (want[index] !== have[index]) {
            return null;
        }
    }
    return params;
}

const routePath = (api: CosmosApi, node: ApiNode) => `${api.basePath.replace(/\/$/, "")}/${String(node.props.path ?? "/items").replace(/^\//, "")}`;

export function runApiRequest(context: RunContext, request: ApiTestRequest): RunOutcome & {route: string} {
    const {api} = context;
    const method = request.method.toUpperCase();
    const path = request.path.split("?")[0];
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));

    const notes: string[] = [];
    let entry: ApiNode | undefined;
    let params: Record<string, string> = {};
    for (const node of api.graph.nodes) {
        if (node.kind !== "route" || String(node.props.method ?? "GET").toUpperCase() !== method) {
            continue;
        }
        const found = matchPath(routePath(api, node), path);
        if (found) {
            entry = node;
            params = found;
            break;
        }
    }

    const failed = (status: number, error: string, route = ""): RunOutcome & {route: string} => ({
        status, body: {error}, replies: [], steps: [], logs: [], notes, changes: 0, error, route
    });

    if (api.security.requireApiKey && request.sendKey === false && !(entry && entry.props.public === true)) {
        // The key is checked before the route is looked up, so an unknown path gives the same answer.
        return failed(401, "Unauthorized");
    }
    if (!entry) {
        return failed(404, "Not found");
    }
    if (JSON.stringify(request.body ?? null).length > api.security.maxBodyKb * 1024) {
        return failed(413, "The request is too big.", `${method} ${routePath(api, entry)}`);
    }

    const run = new Run(context, {params, query: parseQuery(request.query), headers, body: request.body ?? null});
    run.start(entry);
    if (!run.answered) {
        notes.push("The flow ended without a Respond node, so the server would answer 204.");
    }
    return {
        status: run.answered ? run.status : 204,
        body: run.answered ? run.body : null,
        replies: [],
        steps: run.steps,
        logs: run.logs,
        notes: [...notes, ...run.notes],
        changes: run.changes,
        route: `${method} ${routePath(api, entry)}`
    };
}

export function runSocketEvent(context: RunContext, request: SocketTestRequest): RunOutcome {
    const entry = context.api.graph.nodes.find((node) => node.kind === "wsEvent" && String(node.props.event ?? "message") === request.event);
    if (!entry) {
        return {status: 0, body: null, replies: [], steps: [], logs: [], notes: [], changes: 0, error: `No "WebSocket event" node listens for "${request.event}".`};
    }
    const run = new Run(context, {params: {}, query: {}, headers: {}, body: request.data ?? null});
    run.start(entry);
    return {
        status: run.status, body: run.body, replies: run.replies, steps: run.steps, logs: run.logs, notes: run.notes, changes: run.changes,
        error: run.answered && run.status >= 400 ? asText((run.body as {error?: string} | null)?.error) : undefined
    };
}

/** Rows the sandbox needs to start from, so a table of the real data can be copied in. */
export function emptySandbox(database: CosmosDatabase | null): Sandbox {
    return new Map((database?.tables ?? []).map((table) => [table.id, [] as RowData[]]));
}

