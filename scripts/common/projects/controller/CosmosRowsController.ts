import {ipcMain} from "electron";
import type {ProjectModel} from "../../models/ProjectModel";
import type {RowStoreModel} from "../../models/RowStoreModel";
import {isRecord} from "../../utils/GuardHelper";
import {CosmosIPC} from "../CosmosConnection";

const MAX_DELETE_IDS = 1000;

/** Answers the page's requests about table rows. Every id is checked inside RowStoreModel before it becomes a path. */
export class CosmosRowsController {
    constructor(private readonly projects: Pick<ProjectModel, "isKnown">, private readonly rows: RowStoreModel) {
    }

    register(): void {
        const bad = {ok: false, error: "The request is not valid."};
        const text = (value: unknown): string => (typeof value === "string" ? value : "");

        ipcMain.handle(CosmosIPC.listRows, async (_event, project: unknown, database: unknown, table: unknown, offset: unknown, limit: unknown) => {
            if (!(await this.projects.isKnown(project))) {
                return {rows: [], total: 0, offset: 0};
            }
            return this.rows.list(project as string, text(database), text(table), Number(offset), Number(limit));
        });
        ipcMain.handle(CosmosIPC.insertRow, async (_event, project: unknown, database: unknown, table: unknown, values: unknown) => {
            if (!(await this.projects.isKnown(project)) || !this.isDatabase(database)) {
                return bad;
            }
            return this.rows.insert(project as string, database, text(table), values);
        });
        ipcMain.handle(CosmosIPC.updateRow, async (_event, project: unknown, database: unknown, table: unknown, rowId: unknown, values: unknown) => {
            if (!(await this.projects.isKnown(project)) || !this.isDatabase(database)) {
                return bad;
            }
            return this.rows.updateRow(project as string, database, text(table), text(rowId), values);
        });
        ipcMain.handle(CosmosIPC.deleteRows, async (_event, project: unknown, database: unknown, table: unknown, rowIds: unknown) => {
            if (!(await this.projects.isKnown(project)) || !Array.isArray(rowIds)) {
                return bad;
            }
            const ids = rowIds.filter((id): id is string => typeof id === "string").slice(0, MAX_DELETE_IDS);
            return this.rows.deleteRows(project as string, text(database), text(table), ids);
        });
        ipcMain.handle(CosmosIPC.deleteTableData, async (_event, project: unknown, database: unknown, table: unknown) => {
            if (await this.projects.isKnown(project)) {
                await this.rows.deleteTableData(project as string, text(database), typeof table === "string" ? table : null);
            }
        });
    }

    /** The shape RowStoreModel relies on: an id and a list of tables. It checks the rest itself. */
    private isDatabase(value: unknown): value is import("../../CommonInterface").CosmosDatabase {
        return isRecord(value) && typeof value.id === "string" && Array.isArray(value.tables);
    }
}
