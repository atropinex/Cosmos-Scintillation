import {createReadStream, promises as fs} from "fs";
import {createInterface} from "readline";
import {basename, dirname, join} from "path";
import type {CosmosColumn, CosmosDatabase, RowData, RowPage, RowResult} from "../CommonInterface";
import {DATA_FOLDER, MAX_ROWS_PER_TABLE, PROJECT_FILE, ROW_CACHE_TABLES} from "../projects/CosmosConfig";
import {isRecord} from "../utils/GuardHelper";
import {autoMode, newAutoId} from "../utils/ColumnHelper";
import {makeId} from "../utils/IdHelper";
import {SerialQueue} from "./FileModel";

/** Ids become folder and file names, so only these characters are allowed (no dots, no slashes). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT_LENGTH = 20000;
/** One page is read at most this big, so a huge row cannot fill the memory. */
const MAX_PAGE_ROWS = 500;

type Cell = string | number | boolean | null;
type Kind = "integer" | "float" | "boolean" | "text";

/** Where each row starts in the file. Much smaller than the rows themselves, and it lets a page be read directly. */
interface LineIndex {
    size: number;
    offsets: number[];
}

/**
 * Table rows, stored next to the project: `<project folder>/data/<databaseId>/<tableId>.jsonl`, one JSON object
 * per line. Rows are never all in memory: a page is read from disk at the byte position of its first line, and
 * only the line positions of the last few tables are kept.
 */
export class RowStoreModel {
    private readonly queues = new Map<string, SerialQueue>();
    /** Least recently used first. Holds at most ROW_CACHE_TABLES entries. */
    private readonly indexes = new Map<string, LineIndex>();

    // === Reading === //

    async list(projectPath: string, databaseId: string, tableId: string, offset: number, limit: number): Promise<RowPage> {
        const file = this.fileFor(projectPath, databaseId, tableId);
        const empty: RowPage = {rows: [], total: 0, offset: 0};
        if (!file) {
            return empty;
        }

        const index = await this.index(file);
        const total = index.offsets.length;
        const start = Math.max(0, Math.min(Math.floor(offset) || 0, total));
        const end = Math.min(total, start + Math.max(1, Math.min(Math.floor(limit) || 50, MAX_PAGE_ROWS)));
        if (start >= end) {
            return {rows: [], total, offset: start};
        }

        const from = index.offsets[start];
        const to = end < total ? index.offsets[end] : index.size;
        const handle = await fs.open(file, "r");
        try {
            const buffer = Buffer.alloc(to - from);
            await handle.read(buffer, 0, buffer.length, from);
            const rows: RowData[] = [];
            for (const line of buffer.toString("utf8").split("\n")) {
                const row = parseLine(line);
                if (row) {
                    rows.push(row);
                }
            }
            return {rows, total, offset: start};
        } finally {
            await handle.close();
        }
    }

    // === Writing === //

    insert(projectPath: string, database: CosmosDatabase, tableId: string, values: unknown): Promise<RowResult> {
        return this.write(projectPath, database, tableId, async (file, columns) => {
            const checked = coerceRow(columns, values, true);
            if (typeof checked === "string") {
                return {ok: false, error: checked};
            }

            const index = await this.index(file);
            if (index.offsets.length >= MAX_ROWS_PER_TABLE) {
                return {ok: false, error: `A table can hold at most ${MAX_ROWS_PER_TABLE} rows.`};
            }

            // One pass: find the biggest number of each auto-increment column, and any value that is already taken.
            const keyed = columns.filter((column) => column.primary || column.unique);
            const counters = columns.filter((column) => column.autoIncrement && kindOf(column.type) === "integer");
            const maxima = new Map<string, number>();
            if (index.offsets.length > 0 && (keyed.length > 0 || counters.length > 0)) {
                for await (const row of readRows(file)) {
                    const clash = findClash(keyed, checked, row);
                    if (clash) {
                        return {ok: false, error: clash};
                    }
                    for (const column of counters) {
                        const value = row[column.id];
                        if (typeof value === "number") {
                            maxima.set(column.id, Math.max(maxima.get(column.id) ?? 0, value));
                        }
                    }
                }
            }

            for (const column of counters) {
                if (checked[column.id] === null || checked[column.id] === undefined) {
                    checked[column.id] = (maxima.get(column.id) ?? 0) + 1;
                }
            }
            // Columns that are automatic but not numbers get a new unique id (a uuid).
            for (const column of columns.filter((item) => item.autoIncrement && autoMode(item.type) === "id")) {
                if (checked[column.id] === null || checked[column.id] === undefined || checked[column.id] === "") {
                    checked[column.id] = newAutoId(column.type);
                }
            }
            const problem = checkRequired(columns, checked);
            if (problem) {
                return {ok: false, error: problem};
            }

            const row: RowData = {_rid: makeId("r"), ...checked};
            await fs.mkdir(dirname(file), {recursive: true});
            await fs.appendFile(file, JSON.stringify(row) + "\n", "utf8");
            return {ok: true, row};
        });
    }

    updateRow(projectPath: string, database: CosmosDatabase, tableId: string, rowId: string, values: unknown): Promise<RowResult> {
        return this.write(projectPath, database, tableId, async (file, columns) => {
            const checked = coerceRow(columns, values, false);
            if (typeof checked === "string") {
                return {ok: false, error: checked};
            }

            const keyed = columns.filter((column) => column.primary || column.unique);
            let result: RowResult = {ok: false, error: "That row no longer exists."};

            await this.rewrite(file, (row) => {
                if (row._rid !== rowId) {
                    return row;
                }
                const merged = {...row, ...checked} as RowData;
                const problem = checkRequired(columns, merged);
                if (problem) {
                    result = {ok: false, error: problem};
                    return row;
                }
                result = {ok: true, row: merged};
                return merged;
            }, async (merged) => {
                // Unique columns are checked in a first pass against every other row.
                if (result.ok && keyed.length > 0 && result.row) {
                    for await (const other of readRows(file)) {
                        if (other._rid !== rowId) {
                            const clash = findClash(keyed, merged, other);
                            if (clash) {
                                result = {ok: false, error: clash};
                                break;
                            }
                        }
                    }
                }
                return result.ok;
            });
            return result;
        });
    }

    deleteRows(projectPath: string, databaseId: string, tableId: string, rowIds: string[]): Promise<RowResult> {
        return this.write(projectPath, databaseId, tableId, [], async (file) => {
            const doomed = new Set(rowIds.filter((id) => SAFE_ID.test(id)));
            let removed = 0;
            await this.rewrite(file, (row) => {
                if (doomed.has(row._rid)) {
                    removed++;
                    return null;
                }
                return row;
            });
            return {ok: true, removed};
        });
    }

    /** Removes the saved rows of one table, or of the whole database when `tableId` is null. */
    async deleteTableData(projectPath: string, databaseId: string, tableId: string | null): Promise<void> {
        const root = this.dataRoot(projectPath);
        if (!root || !SAFE_ID.test(databaseId) || (tableId !== null && !SAFE_ID.test(tableId))) {
            return;
        }
        const target = tableId === null ? join(root, databaseId) : join(root, databaseId, `${tableId}.jsonl`);
        const queue = this.queueFor(root);
        await queue.run(async () => {
            await fs.rm(target, {recursive: true, force: true});
            for (const key of [...this.indexes.keys()]) {
                if (key.startsWith(target)) {
                    this.indexes.delete(key);
                }
            }
        });
    }

    // === Internals === //

    private dataRoot(projectPath: string): string | null {
        if (typeof projectPath !== "string" || basename(projectPath) !== PROJECT_FILE) {
            return null;
        }
        return join(dirname(projectPath), DATA_FOLDER);
    }

    private fileFor(projectPath: string, databaseId: string, tableId: string): string | null {
        const root = this.dataRoot(projectPath);
        if (!root || typeof databaseId !== "string" || typeof tableId !== "string" || !SAFE_ID.test(databaseId) || !SAFE_ID.test(tableId)) {
            return null;
        }
        return join(root, databaseId, `${tableId}.jsonl`);
    }

    private queueFor(key: string): SerialQueue {
        let queue = this.queues.get(key);
        if (!queue) {
            queue = new SerialQueue();
            this.queues.set(key, queue);
        }
        return queue;
    }

    /** Checks the ids, then runs one change at a time per project. The line index is dropped afterwards. */
    private async write(
        projectPath: string, database: CosmosDatabase | string, tableId: string,
        columnsOrAction: CosmosColumn[] | ((file: string, columns: CosmosColumn[]) => Promise<RowResult>),
        maybeAction?: (file: string, columns: CosmosColumn[]) => Promise<RowResult>
    ): Promise<RowResult> {
        const databaseId = typeof database === "string" ? database : database.id;
        const file = this.fileFor(projectPath, databaseId, tableId);
        const root = this.dataRoot(projectPath);
        if (!file || !root) {
            return {ok: false, error: "Invalid project, database or table."};
        }

        let columns: CosmosColumn[] = [];
        const action = maybeAction ?? (columnsOrAction as (file: string, columns: CosmosColumn[]) => Promise<RowResult>);
        if (typeof database !== "string") {
            const table = Array.isArray(database.tables) ? database.tables.find((item) => item.id === tableId) : undefined;
            if (!table || !Array.isArray(table.columns)) {
                return {ok: false, error: "That table does not exist."};
            }
            columns = table.columns;
        }
        return this.queueFor(root).run(async () => {
            try {
                return await action(file, columns);
            } catch (error) {
                return {ok: false, error: (error as Error).message};
            } finally {
                this.indexes.delete(file);
            }
        });
    }

    /**
     * Streams the file into a temporary file, row by row, then swaps it in. `change` returns the row to keep,
     * or null to drop it. `approve` (optional) is asked once, with the changed row, before the swap.
     */
    private async rewrite(
        file: string,
        change: (row: RowData, rows: number) => RowData | null,
        approve?: (changed: RowData) => Promise<boolean>
    ): Promise<void> {
        const temporary = `${file}.tmp`;
        const output = await fs.open(temporary, "w");
        let changed: RowData | null = null;
        let count = 0;
        try {
            if (await exists(file)) {
                for await (const row of readRows(file)) {
                    const next = change(row, count);
                    if (next !== null) {
                        if (next !== row) {
                            changed = next;
                        }
                        await output.write(JSON.stringify(next) + "\n");
                    }
                    count++;
                }
            }
        } finally {
            await output.close();
        }

        if (approve && changed && !(await approve(changed))) {
            await fs.rm(temporary, {force: true});
            return;
        }
        if (approve && !changed) {
            await fs.rm(temporary, {force: true});
            return;
        }
        await fs.rename(temporary, file);
    }

    private async index(file: string): Promise<LineIndex> {
        const stat = await fs.stat(file).catch(() => null);
        if (!stat) {
            return {size: 0, offsets: []};
        }

        const cached = this.indexes.get(file);
        if (cached && cached.size === stat.size) {
            this.indexes.delete(file);
            this.indexes.set(file, cached); // most recently used goes last
            return cached;
        }

        // Read the file in chunks and note where each non-empty line starts.
        const offsets: number[] = [];
        let position = 0;
        let lineStart = 0;
        let lineHasText = false;
        for await (const chunk of createReadStream(file, {highWaterMark: 64 * 1024}) as AsyncIterable<Buffer>) {
            for (let i = 0; i < chunk.length; i++) {
                const byte = chunk[i];
                if (byte === 10) {
                    if (lineHasText) {
                        offsets.push(lineStart);
                    }
                    lineStart = position + i + 1;
                    lineHasText = false;
                } else if (byte !== 13 && byte !== 32) {
                    lineHasText = true;
                }
            }
            position += chunk.length;
        }
        if (lineHasText) {
            offsets.push(lineStart);
        }

        const index = {size: stat.size, offsets};
        this.indexes.set(file, index);
        while (this.indexes.size > ROW_CACHE_TABLES) {
            const oldest = this.indexes.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.indexes.delete(oldest);
        }
        return index;
    }
}

// === Row helpers === //

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

function parseLine(line: string): RowData | null {
    if (line.trim() === "") {
        return null;
    }
    try {
        const raw: unknown = JSON.parse(line);
        return isRecord(raw) && typeof raw._rid === "string" ? (raw as RowData) : null;
    } catch {
        return null; // a damaged line is skipped, not fatal
    }
}

async function* readRows(file: string): AsyncGenerator<RowData> {
    const lines = createInterface({input: createReadStream(file, {encoding: "utf8"}), crlfDelay: Infinity});
    for await (const line of lines) {
        const row = parseLine(line);
        if (row) {
            yield row;
        }
    }
}

function kindOf(type: string): Kind {
    const name = type.toLowerCase();
    if (/(^|[^a-z])(bool|boolean|bit)($|[^a-z])/.test(name)) {
        return "boolean";
    }
    if (/(serial|int|integer|bigint|smallint|tinyint|mediumint|long|counter)$/.test(name) || /^(int|integer|bigint|smallint|tinyint|mediumint|long|serial)/.test(name)) {
        return "integer";
    }
    if (/(float|double|decimal|numeric|real|number|money)/.test(name)) {
        return "float";
    }
    return "text";
}

/**
 * Turns what the page sent into values of the column types. Unknown columns are an error (no mass assignment).
 * Returns the message when something is wrong. With `full` every column is filled in (missing ones become null).
 */
export function coerceRow(columns: CosmosColumn[], values: unknown, full: boolean): Record<string, Cell> | string {
    if (!isRecord(values)) {
        return "The row data is not valid.";
    }

    const byId = new Map(columns.map((column) => [column.id, column]));
    const byName = new Map(columns.map((column) => [column.name, column]));
    const result: Record<string, Cell> = {};

    for (const [key, raw] of Object.entries(values)) {
        if (key === "_rid") {
            continue;
        }
        const column = byId.get(key) ?? byName.get(key);
        if (!column) {
            return `Unknown column "${key.slice(0, 40)}".`;
        }
        const cell = coerceCell(column, raw);
        if (typeof cell === "object" && cell !== null) {
            return cell.error;
        }
        result[column.id] = cell;
    }

    if (full) {
        for (const column of columns) {
            if (!(column.id in result)) {
                result[column.id] = null;
            }
        }
    }
    return result;
}

export function coerceCell(column: CosmosColumn, raw: unknown): Cell | {error: string} {
    if (raw === null || raw === undefined || (raw === "" && kindOf(column.type) !== "text")) {
        return null;
    }
    if (typeof raw === "object") {
        return {error: `"${column.name}" must be a single value.`};
    }

    const kind = kindOf(column.type);
    if (kind === "boolean") {
        if (typeof raw === "boolean") {
            return raw;
        }
        const text = String(raw).trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(text)) {
            return true;
        }
        if (["false", "0", "no", "off"].includes(text)) {
            return false;
        }
        return {error: `"${column.name}" must be true or false.`};
    }
    if (kind === "integer" || kind === "float") {
        const number = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (!Number.isFinite(number) || (kind === "integer" && !Number.isInteger(number))) {
            return {error: `"${column.name}" must be ${kind === "integer" ? "a whole number" : "a number"}.`};
        }
        return number;
    }
    const text = String(raw);
    if (text.length > MAX_TEXT_LENGTH) {
        return {error: `"${column.name}" is longer than ${MAX_TEXT_LENGTH} characters.`};
    }
    return text;
}

/** Not-null and primary-key columns must have a value (auto-increment ones are filled in before this runs). */
export function checkRequired(columns: CosmosColumn[], row: Record<string, unknown>): string | null {
    for (const column of columns) {
        const value = row[column.id];
        const empty = value === null || value === undefined || value === "";
        if (empty && (column.primary || !column.nullable) && !column.autoIncrement) {
            return `"${column.name}" is required.`;
        }
    }
    return null;
}

/** A message when `row` has the same value as `other` in a primary-key or unique column. */
export function findClash(keyed: CosmosColumn[], row: Record<string, unknown>, other: RowData): string | null {
    for (const column of keyed) {
        const value = row[column.id];
        if (value !== null && value !== undefined && value === other[column.id]) {
            return `"${column.name}" must be unique: "${String(value).slice(0, 40)}" is already used.`;
        }
    }
    return null;
}
