import type {CosmosDatabase, CosmosTable, RowPage, RowResult} from "../../../common/CommonInterface";
import {dummyRow} from "../../../common/utils/DummyData";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {getDocument} from "../document/CosmosDocument.Controller";
import {getSettings} from "../settings/CosmosSettings.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";

interface RowsState {
    databaseId: string;
    tableId: string;
    offset: number;
    page: RowPage | null;
    loading: boolean;
    /** The last problem reported by the main process, shown above the grid. */
    error: string;
    /** `_rid` values of the ticked rows. */
    selected: string[];
}

const EMPTY: RowsState = {databaseId: "", tableId: "", offset: 0, page: null, loading: false, error: "", selected: []};

const rowsStore = createStore<RowsState>(EMPTY);
export const useRows = () => useStore(rowsStore);
export const getRows = () => rowsStore.get();

let requestCounter = 0;

/** Reads one page from disk. Only this page is ever in memory. */
export async function loadRows(databaseId: string, tableId: string, offset = 0): Promise<void> {
    const {path} = getDocument();
    if (!path || !tableId) {
        rowsStore.set(EMPTY);
        return;
    }

    const request = ++requestCounter;
    const same = rowsStore.get().tableId === tableId && rowsStore.get().databaseId === databaseId;
    rowsStore.set((state) => ({
        ...(same ? state : EMPTY), databaseId, tableId, offset, loading: true, selected: same ? state.selected : []
    }));

    try {
        const page = await window.api.listRows(path, databaseId, tableId, offset, getSettings().rowsPerPage);
        if (request === requestCounter) {
            rowsStore.set((state) => ({...state, page, loading: false, offset: page.offset}));
        }
    } catch (error) {
        if (request === requestCounter) {
            rowsStore.set((state) => ({...state, loading: false, error: (error as Error).message}));
        }
    }
}

export const reloadRows = () => {
    const {databaseId, tableId, offset} = rowsStore.get();
    return loadRows(databaseId, tableId, offset);
};

/** Frees the page when the Data tab is left. */
export const clearRows = () => {
    requestCounter++;
    rowsStore.set(EMPTY);
};

function report(result: RowResult): boolean {
    rowsStore.set((state) => ({...state, error: result.ok ? "" : result.error ?? "That did not work."}));
    return result.ok;
}

export const insertRow = exclusive(async (database: CosmosDatabase, tableId: string, values: Record<string, unknown>): Promise<void> => {
    const {path} = getDocument();
    if (path && report(await window.api.insertRow(path, database, tableId, values))) {
        await reloadRows();
    }
});

export const updateCell = exclusive(async (database: CosmosDatabase, tableId: string, rowId: string, values: Record<string, unknown>): Promise<void> => {
    const {path} = getDocument();
    if (path && report(await window.api.updateRow(path, database, tableId, rowId, values))) {
        await reloadRows();
    }
}, (_database, _tableId, rowId) => rowId);

export const toggleRow = (rid: string) => rowsStore.set((state) => ({
    ...state,
    selected: state.selected.includes(rid) ? state.selected.filter((item) => item !== rid) : [...state.selected, rid]
}));

export const toggleAllRows = () => rowsStore.set((state) => {
    const ids = state.page?.rows.map((row) => row._rid) ?? [];
    return {...state, selected: ids.length > 0 && ids.every((id) => state.selected.includes(id)) ? [] : ids};
});

/** Rows are only deleted after the user confirms. */
export const deleteSelectedRows = exclusive(async (): Promise<void> => {
    const {path} = getDocument();
    const {databaseId, tableId, selected} = rowsStore.get();
    if (!path || selected.length === 0) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete ${selected.length} row${selected.length === 1 ? "" : "s"}?`,
        message: "The data is removed from disk. Undo can not bring it back.",
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) {
        return;
    }

    if (report(await window.api.deleteRows(path, databaseId, tableId, selected))) {
        rowsStore.set((state) => ({...state, selected: []}));
        await reloadRows();
        showToast("Rows deleted");
    }
});

export const deleteAllRows = exclusive(async (tableName: string): Promise<void> => {
    const {path} = getDocument();
    const {databaseId, tableId, page} = rowsStore.get();
    if (!path || !page || page.total === 0) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete all ${page.total} rows of "${tableName}"?`,
        message: "The table stays, its data is removed from disk. Undo can not bring it back.",
        confirmLabel: "Delete all rows",
        danger: true,
        typeToConfirm: tableName
    });
    if (!confirmed) {
        return;
    }

    await window.api.deleteTableData(path, databaseId, tableId);
    rowsStore.set((state) => ({...state, selected: []}));
    await reloadRows();
    showToast("All rows deleted");
});

// === Made-up rows === //

/** Values a column that points at another table may use: the ones that table already has. */
async function referenceChoices(database: CosmosDatabase, table: CosmosTable): Promise<Map<string, string[]>> {
    const {path} = getDocument();
    const choices = new Map<string, string[]>();
    for (const column of table.columns) {
        const target = column.ref ? database.tables.find((item) => item.id === column.ref!.tableId) : undefined;
        if (!path || !column.ref || !target) {
            continue;
        }
        const page = await window.api.listRows(path, database.id, target.id, 0, 200);
        choices.set(column.id, page.rows.map((row) => row[column.ref!.columnId]).filter((value) => value !== null && value !== undefined && value !== "").map(String));
    }
    return choices;
}

/** One made-up row for the "Add row" line. Returns what to put in the boxes. */
export async function oneDummyRow(database: CosmosDatabase, table: CosmosTable): Promise<Record<string, string>> {
    return dummyRow(table.columns, Math.floor(Math.random() * 1000), Math.random, await referenceChoices(database, table));
}

/** Adds made-up rows one by one, so every row follows the table's rules. A row that clashes is made again. */
export const addDummyRows = exclusive(async (database: CosmosDatabase, table: CosmosTable, count: number): Promise<void> => {
    const {path} = getDocument();
    if (!path) {
        return;
    }
    const refs = await referenceChoices(database, table);
    const needsTarget = table.columns.find((column) => column.ref && !column.nullable && (refs.get(column.id) ?? []).length === 0);
    if (needsTarget) {
        const target = database.tables.find((item) => item.id === needsTarget.ref!.tableId);
        showToast(`Add a row to "${target?.name ?? "the other table"}" first. "${needsTarget.name}" points at it.`, true);
        return;
    }

    let added = 0;
    let lastError = "";
    for (let index = 0; index < count; index++) {
        let done = false;
        for (let attempt = 0; attempt < 4 && !done; attempt++) {
            const result = await window.api.insertRow(path, database, table.id, dummyRow(table.columns, index + attempt * 1000, Math.random, refs));
            done = result.ok;
            lastError = result.ok ? "" : result.error ?? "";
        }
        if (!done) {
            break;
        }
        added++;
    }
    await reloadRows();
    rowsStore.set((state) => ({...state, error: lastError}));
    showToast(added === count ? `Added ${added} made-up ${added === 1 ? "row" : "rows"}` : `Added ${added} of ${count}. ${lastError}`, added !== count);
});
