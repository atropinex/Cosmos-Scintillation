import type {ApiNode, CosmosApi, CosmosColumn, CosmosDatabase, CosmosTable} from "../../../common/CommonInterface";
import {autoMode} from "../../../common/utils/ColumnHelper";

// === What a JSON box can suggest: the field names an API or a table expects === //

export interface JsonHint {
    key: string;
    /** A value that fits, used when the field is filled in. */
    example: unknown;
    /** Short text shown next to the suggestion, for example "text" or "number". */
    label: string;
}

function exampleFor(column: CosmosColumn): JsonHint {
    const type = column.type.toLowerCase();
    if (/^(bool|boolean|bit)/.test(type)) {
        return {key: column.name, example: false, label: "yes/no"};
    }
    if (autoMode(type) === "count" && !/^(serial)/.test(type)) {
        return {key: column.name, example: 0, label: "whole number"};
    }
    if (/(float|double|decimal|numeric|real|number|money)/.test(type)) {
        return {key: column.name, example: 0, label: "number"};
    }
    if (/^(json|jsonb|object)/.test(type)) {
        return {key: column.name, example: {}, label: "object"};
    }
    if (/^(array)/.test(type)) {
        return {key: column.name, example: [], label: "list"};
    }
    if (/(date|time)/.test(type)) {
        return {key: column.name, example: "2025-01-01T00:00:00.000Z", label: "date"};
    }
    return {key: column.name, example: "", label: "text"};
}

/** The fields to send to add a row: every column that is not filled in automatically. */
export function hintsForTable(table: CosmosTable | undefined): JsonHint[] {
    return (table?.columns ?? []).filter((column) => !column.autoIncrement).map(exampleFor);
}

const ENTRY_KINDS = new Set(["validate", "dbInsert", "dbUpdate"]);

/** The nodes a flow reaches by following its "then", "true" and "false" outputs from an entry node. */
function reachable(api: CosmosApi, startId: string): ApiNode[] {
    const byId = new Map(api.graph.nodes.map((node) => [node.id, node]));
    const seen = new Set<string>([startId]);
    const queue = [startId];
    const found: ApiNode[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        for (const link of api.graph.links) {
            if (link.from.node === id && ["then", "true", "false"].includes(link.from.pin) && !seen.has(link.to.node)) {
                seen.add(link.to.node);
                queue.push(link.to.node);
                const node = byId.get(link.to.node);
                if (node) {
                    found.push(node);
                }
            }
        }
    }
    return found;
}

function bodyKeys(api: CosmosApi): JsonHint[] {
    const keys = new Set(api.graph.nodes.filter((node) => node.kind === "bodyField").map((node) => String(node.props.key ?? "")).filter(Boolean));
    return [...keys].map((key) => ({key, example: "", label: "text"}));
}

/** Fields for the body of one route: the table the flow saves into, or else the fields its blocks read from the body. */
export function hintsForRoute(api: CosmosApi, database: CosmosDatabase | undefined, routeId: string): JsonHint[] {
    const saver = reachable(api, routeId).find((node) => ENTRY_KINDS.has(node.kind) && node.props.table);
    const table = saver && database?.tables.find((item) => item.name === saver.props.table || item.id === saver.props.table);
    return table ? hintsForTable(table) : bodyKeys(api);
}

/** Fields for a WebSocket message: whatever the blocks read from the message. */
export function hintsForEvent(api: CosmosApi): JsonHint[] {
    return bodyKeys(api);
}

// === Formatting === //

/** The text laid out with two spaces, or null when it is not JSON. Empty text stays empty. */
export function formatJson(text: string): string | null {
    if (text.trim() === "") {
        return "";
    }
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return null;
    }
}

/** What is wrong with the text, in plain words, or "" when it is fine. */
export function jsonProblem(text: string): string {
    if (text.trim() === "") {
        return "";
    }
    try {
        JSON.parse(text);
        return "";
    } catch (error) {
        return (error as Error).message.replace(/^JSON\.parse: /, "").replace(/ in JSON at position (\d+).*/, " at character $1");
    }
}

/** A starting text with every suggested field, ready to fill in. */
export function sampleJson(hints: JsonHint[]): string {
    return JSON.stringify(Object.fromEntries(hints.map((hint) => [hint.key, hint.example])), null, 2);
}
