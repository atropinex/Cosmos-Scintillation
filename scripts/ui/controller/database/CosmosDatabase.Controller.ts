import type {CosmosColumn, CosmosDatabase, CosmosTable, EngineDefinition} from "../../../common/CommonInterface";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {createColumn, createTable} from "../../../common/utils/ProjectFactory";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {getDocument, updateDatabase, updateTable} from "../document/CosmosDocument.Controller";
import {getEngine} from "../registry/CosmosRegistry.Controller";
import {showToast} from "../toast/CosmosToast.Controller";
import {clearSchemaSelection, getSchemaSelection, selectInSchema} from "./CosmosSchema.Controller";

/** Names stay unique inside their list, so exported scripts never clash. */
export function uniqueName(existing: string[], wanted: string): string {
    const base = wanted.trim().slice(0, 60) || "untitled";
    let name = base;
    let counter = 2;
    while (existing.includes(name)) {
        name = `${base}_${counter}`;
        counter++;
    }
    return name;
}

export const getEngineOf = (database: CosmosDatabase): EngineDefinition | undefined => getEngine(database.engine);

// === Tables === //

export function addTable(database: CosmosDatabase, x?: number, y?: number): void {
    const engine = getEngineOf(database);
    if (!engine) {
        return;
    }

    // New tables go to the right of the others, so they never land on top of one.
    const right = database.tables.reduce((max, table) => Math.max(max, table.x + 280), 40);
    const name = uniqueName(database.tables.map((table) => table.name), engine.terms.container.toLowerCase());
    const table = createTable(engine, name, x ?? right, y ?? 40);

    updateDatabase(database.id, (current) => ({...current, tables: [...current.tables, table]}));
    selectInSchema(table.id);
}

export function renameTable(databaseId: string, tableId: string, name: string): void {
    updateTable(databaseId, tableId, (table) => ({...table, name: name.slice(0, 60)}), `rename-${tableId}`);
}

/** The rows of a deleted table are deleted too and Undo can't bring them back, so the user has to type the name. */
export const deleteTable = exclusive(async (databaseId: string, tableId: string): Promise<void> => {
    const {project, path} = getDocument();
    const database = project?.databases.find((item) => item.id === databaseId);
    const table = database?.tables.find((item) => item.id === tableId);
    const engine = database ? getEngineOf(database) : undefined;
    if (!path || !database || !table) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete ${engine?.terms.container.toLowerCase() ?? "table"} "${table.name}"?`,
        message: `Its ${table.columns.length} ${engine?.terms.fields.toLowerCase() ?? "columns"} and all of its data will be removed. The data can not be brought back with Undo.`,
        confirmLabel: "Delete",
        danger: true,
        typeToConfirm: table.name
    });
    if (!confirmed) {
        return;
    }

    await window.api.deleteTableData(path, databaseId, tableId);
    updateDatabase(databaseId, (current) => ({
        ...current,
        tables: current.tables
            .filter((item) => item.id !== tableId)
            // References that pointed at the table are cut, so nothing points at nothing.
            .map((item) => item.columns.some((column) => column.ref?.tableId === tableId)
                ? {...item, columns: item.columns.map((column) => column.ref?.tableId === tableId ? {...column, ref: null} : column)}
                : item)
    }));
    if (getSchemaSelection().tableId === tableId) {
        clearSchemaSelection();
    }
    showToast(`Deleted "${table.name}"`);
}, (databaseId, tableId) => `${databaseId}${tableId}`);

// === Columns === //

export function addColumn(database: CosmosDatabase, table: CosmosTable): void {
    const engine = getEngineOf(database);
    if (!engine) {
        return;
    }

    const name = uniqueName(table.columns.map((column) => column.name), engine.terms.field.toLowerCase());
    const column = createColumn(engine, name);
    updateTable(database.id, table.id, (current) => ({...current, columns: [...current.columns, column]}));
    selectInSchema(table.id, column.id);
}

export function patchColumn(databaseId: string, tableId: string, columnId: string, patch: Partial<CosmosColumn>, coalesceKey = ""): void {
    updateTable(databaseId, tableId, (table) => ({
        ...table,
        columns: table.columns.map((column) => {
            if (column.id !== columnId) {
                return column;
            }
            const next = {...column, ...patch};
            // A key can't be empty.
            return next.primary ? {...next, nullable: false} : next;
        })
    }), coalesceKey);
}

export function moveColumn(databaseId: string, tableId: string, columnId: string, direction: -1 | 1): void {
    updateTable(databaseId, tableId, (table) => {
        const index = table.columns.findIndex((column) => column.id === columnId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= table.columns.length) {
            return table;
        }
        const columns = [...table.columns];
        [columns[index], columns[target]] = [columns[target], columns[index]];
        return {...table, columns};
    });
}

/** Removing a column also drops its data, so it asks first. */
export const deleteColumn = exclusive(async (databaseId: string, tableId: string, columnId: string): Promise<void> => {
    const database = getDocument().project?.databases.find((item) => item.id === databaseId);
    const table = database?.tables.find((item) => item.id === tableId);
    const column = table?.columns.find((item) => item.id === columnId);
    if (!table || !column) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete "${column.name}"?`,
        message: "The values saved in this column stay in the data file but are no longer shown. Anything that pointed at it loses its reference.",
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) {
        return;
    }

    updateDatabase(databaseId, (current) => ({
        ...current,
        tables: current.tables.map((item) => ({
            ...item,
            columns: item.id === tableId
                ? item.columns.filter((entry) => entry.id !== columnId)
                : item.columns.map((entry) => entry.ref?.columnId === columnId ? {...entry, ref: null} : entry)
        }))
    }));
    if (getSchemaSelection().columnId === columnId) {
        selectInSchema(tableId);
    }
}, (databaseId, tableId, columnId) => columnId);
