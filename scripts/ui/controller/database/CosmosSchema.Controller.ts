import type {CosmosDatabase, CosmosTable} from "../../../common/CommonInterface";
import {clamp} from "../../../common/utils/GuardHelper";
import {changeProject, updateTable} from "../document/CosmosDocument.Controller";
import {getSettings} from "../settings/CosmosSettings.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";

// === Sizes of the drawn tables. The lines are worked out from them, so the view and the lines agree. === //
export const TABLE_WIDTH = 248;
export const HEADER_HEIGHT = 34;
export const ROW_HEIGHT = 26;
export const TABLE_PADDING = 6;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

export const tableHeight = (table: CosmosTable) => HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + TABLE_PADDING;

/** The vertical middle of a column's row, in diagram coordinates. */
export const columnY = (table: CosmosTable, columnId: string) => {
    const index = Math.max(0, table.columns.findIndex((column) => column.id === columnId));
    return table.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
};

// === Pan and zoom. Kept out of the project, so moving the camera never marks it as changed. === //

export interface Camera {
    x: number;
    y: number;
    zoom: number;
}

const cameraStore = createStore<Camera>({x: 40, y: 40, zoom: 1});
export const useCamera = () => useStore(cameraStore);
export const getCamera = () => cameraStore.get();

export const panBy = (dx: number, dy: number) => cameraStore.set((camera) => ({...camera, x: camera.x + dx, y: camera.y + dy}));

/** Zooms so the point under the cursor stays where it is. */
export function zoomAt(factor: number, screenX: number, screenY: number): void {
    cameraStore.set((camera) => {
        const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const ratio = zoom / camera.zoom;
        return {zoom, x: screenX - (screenX - camera.x) * ratio, y: screenY - (screenY - camera.y) * ratio};
    });
}

/** Shows every table, as large as fits. */
export function fitToTables(database: CosmosDatabase, width: number, height: number): void {
    if (database.tables.length === 0) {
        cameraStore.set({x: 40, y: 40, zoom: 1});
        return;
    }

    const left = Math.min(...database.tables.map((table) => table.x));
    const top = Math.min(...database.tables.map((table) => table.y));
    const right = Math.max(...database.tables.map((table) => table.x + TABLE_WIDTH));
    const bottom = Math.max(...database.tables.map((table) => table.y + tableHeight(table)));
    const zoom = clamp(Math.min((width - 80) / (right - left), (height - 80) / (bottom - top)), MIN_ZOOM, 1);

    cameraStore.set({
        zoom,
        x: (width - (right - left) * zoom) / 2 - left * zoom,
        y: (height - (bottom - top) * zoom) / 2 - top * zoom
    });
}

// === What is selected or hovered === //

export interface SchemaSelection {
    tableId: string;
    columnId: string;
}

const selectionStore = createStore<SchemaSelection>({tableId: "", columnId: ""});
export const useSchemaSelection = () => useStore(selectionStore);
export const getSchemaSelection = () => selectionStore.get();
export const selectInSchema = (tableId: string, columnId = "") => selectionStore.set({tableId, columnId});
export const clearSchemaSelection = () => selectionStore.set({tableId: "", columnId: ""});

const hoverStore = createStore<string>("");
export const useHoveredTable = () => useStore(hoverStore);
export const hoverTable = (tableId: string) => hoverStore.set(tableId);

// === Moving a table. Only the position is saved, as one undo step per drag. === //

export function moveTable(databaseId: string, tableId: string, x: number, y: number): void {
    const {snapToGrid, gridSize} = getSettings();
    const snap = (value: number) => (snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value));

    changeProject((project) => ({
        ...project,
        databases: project.databases.map((database) => database.id !== databaseId ? database : {
            ...database,
            tables: database.tables.map((table) => table.id === tableId ? {...table, x: snap(x), y: snap(y)} : table)
        })
    }), `move-${tableId}`);
}

// === Dragging a new reference from a column to another column === //

export interface Connecting {
    fromTableId: string;
    fromColumnId: string;
    /** Where the cursor is, in diagram coordinates. */
    x: number;
    y: number;
}

const connectStore = createStore<Connecting | null>(null);
export const useConnecting = () => useStore(connectStore);
export const getConnecting = () => connectStore.get();
export const startConnecting = (value: Connecting) => connectStore.set(value);
export const moveConnecting = (x: number, y: number) => connectStore.set((state) => state && {...state, x, y});
export const stopConnecting = () => connectStore.set(null);

/** Makes the dragged column point at the column it was dropped on. */
export function finishConnecting(databaseId: string, toTableId: string, toColumnId: string): void {
    const from = connectStore.get();
    connectStore.set(null);
    if (!from || (from.fromTableId === toTableId && from.fromColumnId === toColumnId)) {
        return;
    }

    updateTable(databaseId, from.fromTableId, (table: CosmosTable) => ({
        ...table,
        columns: table.columns.map((column) => column.id === from.fromColumnId
            ? {...column, ref: {tableId: toTableId, columnId: toColumnId, onDelete: column.ref?.onDelete ?? "no action"}}
            : column)
    }));
}
