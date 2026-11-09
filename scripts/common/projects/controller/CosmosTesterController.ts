import {ipcMain} from "electron";
import type {
    ApiTestRequest, ApiTestResult, CosmosDatabase, DatabaseCheckIssue, DatabaseCheckResult, RowData, RowQuery, RowQueryResult,
    SocketTestRequest, SocketTestResult
} from "../../CommonInterface";
import {emptySandbox, runApiRequest, runSocketEvent, type RunContext, type Sandbox} from "../../tester/GraphRunner";
import type {ProjectModel} from "../../models/ProjectModel";
import {sanitizeApi, sanitizeDatabase} from "../../models/ProjectSanitizer";
import type {RegistryModel} from "../../models/RegistryModel";
import {checkRequired, coerceRow, type RowStoreModel} from "../../models/RowStoreModel";
import {isRecord} from "../../utils/GuardHelper";
import {CosmosIPC} from "../CosmosConnection";

/** How many rows of one table the safe copy holds. The real table may be bigger; the copy is only for testing. */
const SANDBOX_ROWS_PER_TABLE = 5000;
const SCAN_LIMIT = 20000;
const PAGE = 500;
const SHOWN_ROWS = 100;
const SHOWN_ISSUES = 50;

/**
 * Answers the page's test requests. Flows run on a copy of the rows that lives only in memory, so a test can
 * add, change and remove rows without touching the project. The copy is kept while the app runs, so a POST can be
 * followed by a GET; "reset" throws it away.
 */
export class CosmosTesterController {
    private readonly sandboxes = new Map<string, Sandbox>();

    constructor(
        private readonly projects: Pick<ProjectModel, "isKnown">,
        private readonly rows: Pick<RowStoreModel, "list">,
        private readonly registry: Pick<RegistryModel, "list">
    ) {
    }

    register(): void {
        ipcMain.handle(CosmosIPC.testApi, (_event, project: unknown, api: unknown, database: unknown, request: unknown) => this.testApi(project, api, database, request));
        ipcMain.handle(CosmosIPC.testSocket, (_event, project: unknown, api: unknown, database: unknown, request: unknown) => this.testSocket(project, api, database, request));
        ipcMain.handle(CosmosIPC.resetTestData, async (_event, project: unknown) => {
            for (const key of [...this.sandboxes.keys()]) {
                if (key.startsWith(`${String(project)}|`)) {
                    this.sandboxes.delete(key);
                }
            }
        });
        ipcMain.handle(CosmosIPC.queryRows, (_event, project: unknown, database: unknown, query: unknown) => this.query(project, database, query));
        ipcMain.handle(CosmosIPC.checkRow, (_event, database: unknown, tableId: unknown, values: unknown) => this.checkRow(database, tableId, values));
        ipcMain.handle(CosmosIPC.checkDatabase, (_event, project: unknown, database: unknown) => this.checkDatabase(project, database));
    }

    // === APIs and sockets === //

    private async context(project: unknown, rawApi: unknown, rawDatabase: unknown): Promise<RunContext | string> {
        const api = sanitizeApi(rawApi);
        if (!api || !(await this.projects.isKnown(project))) {
            return "The API data is not valid.";
        }
        const database = isRecord(rawDatabase) ? sanitizeDatabase(rawDatabase) : null;
        const {nodes} = await this.registry.list();
        return {
            api,
            database,
            definitions: new Map(nodes.map((node) => [node.id, node])),
            sandbox: await this.sandboxFor(project as string, database)
        };
    }

    private async sandboxFor(project: string, database: CosmosDatabase | null): Promise<Sandbox> {
        const key = `${project}|${database?.id ?? ""}`;
        const known = this.sandboxes.get(key);
        if (known) {
            // A table added after the copy was made starts empty here; its rows are copied the next time the copy is reset.
            for (const table of database?.tables ?? []) {
                if (!known.has(table.id)) {
                    known.set(table.id, await this.copyRows(project, database!.id, table.id));
                }
            }
            return known;
        }

        const sandbox = emptySandbox(database);
        for (const table of database?.tables ?? []) {
            sandbox.set(table.id, await this.copyRows(project, database!.id, table.id));
        }
        this.sandboxes.set(key, sandbox);
        return sandbox;
    }

    private async copyRows(project: string, databaseId: string, tableId: string): Promise<RowData[]> {
        const copy: RowData[] = [];
        for (let offset = 0; offset < SANDBOX_ROWS_PER_TABLE; offset += PAGE) {
            const page = await this.rows.list(project, databaseId, tableId, offset, PAGE);
            copy.push(...page.rows);
            if (page.rows.length < PAGE) {
                break;
            }
        }
        return copy;
    }

    private async testApi(project: unknown, rawApi: unknown, rawDatabase: unknown, rawRequest: unknown): Promise<ApiTestResult> {
        const started = performance.now();
        const fail = (error: string): ApiTestResult => ({ok: false, status: 0, body: null, route: "", steps: [], logs: [], changes: 0, ms: 0, notes: [], error});
        if (!isRecord(rawRequest) || typeof rawRequest.method !== "string" || typeof rawRequest.path !== "string") {
            return fail("The request is not valid.");
        }
        const context = await this.context(project, rawApi, rawDatabase);
        if (typeof context === "string") {
            return fail(context);
        }

        const request: ApiTestRequest = {
            method: rawRequest.method.slice(0, 10),
            path: rawRequest.path.slice(0, 500),
            query: typeof rawRequest.query === "string" ? rawRequest.query.slice(0, 2000) : "",
            headers: isRecord(rawRequest.headers) ? Object.fromEntries(Object.entries(rawRequest.headers).filter(([, value]) => typeof value === "string").slice(0, 50)) as Record<string, string> : {},
            body: rawRequest.body ?? null,
            sendKey: rawRequest.sendKey !== false
        };
        try {
            const outcome = runApiRequest(context, request);
            return {
                ok: outcome.status < 400, status: outcome.status, body: outcome.body, route: outcome.route, steps: outcome.steps,
                logs: outcome.logs, changes: outcome.changes, notes: outcome.notes, ms: Math.round((performance.now() - started) * 10) / 10, error: outcome.error
            };
        } catch (error) {
            return fail((error as Error).message);
        }
    }

    private async testSocket(project: unknown, rawApi: unknown, rawDatabase: unknown, rawRequest: unknown): Promise<SocketTestResult> {
        const started = performance.now();
        const fail = (error: string): SocketTestResult => ({ok: false, replies: [], steps: [], logs: [], changes: 0, ms: 0, notes: [], error});
        if (!isRecord(rawRequest) || typeof rawRequest.event !== "string") {
            return fail("The message is not valid.");
        }
        const context = await this.context(project, rawApi, rawDatabase);
        if (typeof context === "string") {
            return fail(context);
        }

        const request: SocketTestRequest = {event: rawRequest.event.slice(0, 100), data: rawRequest.data ?? null};
        try {
            const outcome = runSocketEvent(context, request);
            return {
                ok: !outcome.error, replies: outcome.replies, steps: outcome.steps, logs: outcome.logs, changes: outcome.changes, notes: outcome.notes,
                ms: Math.round((performance.now() - started) * 10) / 10, error: outcome.error
            };
        } catch (error) {
            return fail((error as Error).message);
        }
    }

    // === Databases === //

    private async database(project: unknown, raw: unknown): Promise<CosmosDatabase | null> {
        return (await this.projects.isKnown(project)) ? sanitizeDatabase(raw) : null;
    }

    private async query(project: unknown, raw: unknown, rawQuery: unknown): Promise<RowQueryResult> {
        const bad: RowQueryResult = {ok: false, rows: [], more: false, scanned: 0, error: "The query is not valid."};
        const database = await this.database(project, raw);
        if (!database || !isRecord(rawQuery)) {
            return bad;
        }
        const query = rawQuery as unknown as RowQuery;
        const table = database.tables.find((item) => item.id === query.tableId);
        const column = table?.columns.find((item) => item.id === query.columnId);
        if (!table || (!column && query.op !== "empty")) {
            return {...bad, error: "Choose a table and a column."};
        }

        const wanted = String(query.value ?? "").slice(0, 200);
        const matches = (cell: unknown): boolean => {
            if (query.op === "empty") {
                return !column ? true : cell === null || cell === undefined || cell === "";
            }
            const number = Number(cell);
            const target = Number(wanted);
            const numeric = wanted.trim() !== "" && Number.isFinite(number) && Number.isFinite(target) && cell !== null && cell !== "";
            const text = cell === null || cell === undefined ? "" : String(cell);
            switch (query.op) {
                case "eq": return numeric ? number === target : text === wanted;
                case "ne": return numeric ? number !== target : text !== wanted;
                case "lt": return numeric ? number < target : text < wanted;
                case "gt": return numeric ? number > target : text > wanted;
                case "contains": return text.toLowerCase().includes(wanted.toLowerCase());
                default: return false;
            }
        };

        const found: RowData[] = [];
        let scanned = 0;
        let more = false;
        for (let offset = 0; offset < SCAN_LIMIT && !more; offset += PAGE) {
            const page = await this.rows.list(project as string, database.id, table.id, offset, PAGE);
            for (const row of page.rows) {
                scanned++;
                if (!column || matches(row[column.id])) {
                    if (found.length >= SHOWN_ROWS) {
                        more = true;
                        break;
                    }
                    found.push(row);
                }
            }
            if (page.rows.length < PAGE) {
                break;
            }
        }
        return {ok: true, rows: found, more, scanned};
    }

    /** Tries a row against the table's rules without saving it. */
    private async checkRow(raw: unknown, tableId: unknown, values: unknown): Promise<{ok: boolean; message: string}> {
        const database = sanitizeDatabase(raw);
        const table = database?.tables.find((item) => item.id === tableId);
        if (!table) {
            return {ok: false, message: "Choose a table first."};
        }
        const checked = coerceRow(table.columns, values, true);
        if (typeof checked === "string") {
            return {ok: false, message: checked};
        }
        const problem = checkRequired(table.columns.filter((column) => !column.autoIncrement), checked);
        return problem ? {ok: false, message: problem} : {ok: true, message: "This row fits the table. Nothing was saved."};
    }

    /** Reads every table (up to a limit) and reports rows that break the table's own rules. */
    private async checkDatabase(project: unknown, raw: unknown): Promise<DatabaseCheckResult> {
        const database = await this.database(project, raw);
        if (!database) {
            return {ok: false, rowsChecked: 0, issues: [], more: false};
        }

        const tableById = new Map(database.tables.map((table) => [table.id, table]));
        const issues: DatabaseCheckIssue[] = [];
        let more = false;
        let rowsChecked = 0;
        const report = (tableName: string, row: number, message: string) => {
            if (issues.length >= SHOWN_ISSUES) {
                more = true;
            } else {
                issues.push({tableName, row, message});
            }
        };

        // The values that exist in each column that another table points at.
        const targets = new Map<string, Set<string>>();
        for (const table of database.tables) {
            for (const column of table.columns) {
                const target = column.ref ? tableById.get(column.ref.tableId) : undefined;
                const targetColumn = target?.columns.find((item) => item.id === column.ref?.columnId);
                if (target && targetColumn && !targets.has(`${target.id}|${targetColumn.id}`)) {
                    const values = new Set<string>();
                    for await (const row of this.scan(project as string, database.id, target.id)) {
                        values.add(String(row[targetColumn.id]));
                    }
                    targets.set(`${target.id}|${targetColumn.id}`, values);
                }
            }
        }

        for (const table of database.tables) {
            const unique = table.columns.filter((column) => column.primary || column.unique);
            const seen = new Map<string, Set<string>>(unique.map((column) => [column.id, new Set<string>()]));
            let index = 0;

            for await (const row of this.scan(project as string, database.id, table.id)) {
                index++;
                rowsChecked++;
                const problem = checkRequired(table.columns, row);
                if (problem) {
                    report(table.name, index, problem);
                }
                for (const column of unique) {
                    const value = row[column.id];
                    if (value !== null && value !== undefined && value !== "") {
                        const key = String(value);
                        if (seen.get(column.id)!.has(key)) {
                            report(table.name, index, `"${column.name}" has the value "${key.slice(0, 40)}" more than once.`);
                        }
                        seen.get(column.id)!.add(key);
                    }
                }
                for (const column of table.columns) {
                    const target = column.ref ? tableById.get(column.ref.tableId) : undefined;
                    const value = row[column.id];
                    if (column.ref && target && value !== null && value !== undefined && value !== ""
                        && !targets.get(`${target.id}|${column.ref.columnId}`)?.has(String(value))) {
                        report(table.name, index, `"${column.name}" points at "${String(value).slice(0, 40)}", which is not in "${target.name}".`);
                    }
                }
            }
        }
        return {ok: issues.length === 0, rowsChecked, issues, more};
    }

    private async* scan(project: string, databaseId: string, tableId: string): AsyncGenerator<RowData> {
        for (let offset = 0; offset < SCAN_LIMIT; offset += PAGE) {
            const page = await this.rows.list(project, databaseId, tableId, offset, PAGE);
            yield* page.rows;
            if (page.rows.length < PAGE) {
                return;
            }
        }
    }
}
