import {autoMode} from "../../../common/utils/ColumnHelper";
import {useEffect, useState} from "react";
import type {CosmosColumn, CosmosDatabase, RowData} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {getEngineOf} from "../../controller/database/CosmosDatabase.Controller";
import {
    addDummyRows, deleteAllRows, deleteSelectedRows, insertRow, oneDummyRow, loadRows, toggleAllRows, toggleRow, updateCell, useRows
} from "../../controller/database/CosmosRows.Controller";
import {showMenuAtEvent} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import {useSettings} from "../../controller/settings/CosmosSettings.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosDataGrid.module.css";

const isBool = (column: CosmosColumn) => /^(bool|boolean|bit)/i.test(column.type);

/** What the user typed, as the value to save. Empty text in a column that may be empty means "no value". */
function toValue(column: CosmosColumn, text: string): string | null {
    return text === "" && column.nullable ? null : text;
}

interface CellProps {
    column: CosmosColumn;
    row: RowData;
    onSave: (value: string | null) => void;
}

/** A value you can click to change. Enter or leaving the box saves it, Escape cancels. */
function Cell({column, row, onSave}: CellProps) {
    const value = row[column.id];
    const text = value === null || value === undefined ? "" : String(value);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);

    if (isBool(column)) {
        return (
            <select className={styles.cellInput} value={text} onChange={(event) => onSave(event.target.value === "" ? null : event.target.value)}>
                <option value="">{column.nullable ? "(empty)" : "false"}</option>
                <option value="true">true</option>
                <option value="false">false</option>
            </select>
        );
    }
    if (!editing) {
        return (
            <span
                className={cx(styles.cell, value === null && styles.nullValue)} title={text}
                onClick={() => {
                    setDraft(text);
                    setEditing(true);
                }}
            >
                {value === null ? "null" : text}
            </span>
        );
    }

    const finish = (save: boolean) => {
        setEditing(false);
        if (save && draft !== text) {
            onSave(toValue(column, draft));
        }
    };
    return (
        <input
            className={styles.cellInput} autoFocus value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    finish(true);
                } else if (event.key === "Escape") {
                    finish(false);
                }
            }}
        />
    );
}

interface CosmosDataGridProps {
    database: CosmosDatabase;
}

/** The rows of one table. Only the page on screen is read from disk. */
export default function CosmosDataGrid({database}: CosmosDataGridProps) {
    const perPage = useSettings().rowsPerPage;
    const state = useRows();
    const terms = getEngineOf(database)?.terms;
    const [tableId, setTableId] = useState(database.tables[0]?.id ?? "");
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const table = database.tables.find((item) => item.id === tableId) ?? database.tables[0];

    useEffect(() => {
        if (table) {
            void loadRows(database.id, table.id, 0);
        }
    }, [database.id, table?.id]);

    if (!table) {
        return <EmptyState icon="table" title={`No ${terms?.containers.toLowerCase() ?? "tables"} yet`} text="Add one in the Structure tab first."/>;
    }

    const page = state.page;
    const total = page?.total ?? 0;
    const offset = page?.offset ?? 0;
    const allSelected = !!page && page.rows.length > 0 && page.rows.every((row) => state.selected.includes(row._rid));

    const submit = async () => {
        const values: Record<string, unknown> = {};
        for (const column of table.columns) {
            const text = draft[column.name];
            if (text !== undefined && text !== "") {
                values[column.name] = text;
            }
        }
        await insertRow(database, table.id, values);
        setDraft({});
        setAdding(false);
    };

    return (
        <div className={styles.grid}>
            <div className={styles.bar}>
                <select className={styles.picker} value={table.id} onChange={(event) => setTableId(event.target.value)} aria-label={terms?.container ?? "Table"}>
                    {database.tables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <span className={styles.count}>{total} {total === 1 ? (terms?.row ?? "row").toLowerCase() : (terms?.rows ?? "rows").toLowerCase()}</span>
                <span className={styles.grow}/>
                {state.selected.length > 0 && (
                    <button className={cx(controls.btn, controls.btnDanger)} onClick={() => void deleteSelectedRows()}>
                        <CosmosIcon name="trash" size={14}/>
                        Delete {state.selected.length} selected
                    </button>
                )}
                {total > 0 && (
                    <button className={controls.btn} onClick={() => void deleteAllRows(table.name)}>Delete all</button>
                )}
                <button
                    className={controls.btn} disabled={table.columns.length === 0} title="Add rows with made-up values that fit each column"
                    onClick={(event) => showMenuAtEvent(event, [1, 5, 10, 25, 50, 100].map((count) => ({
                        label: count === 1 ? "Add 1 made-up row" : `Add ${count} made-up rows`,
                        onSelect: () => void addDummyRows(database, table, count)
                    })))}
                >
                    <CosmosIcon name="plus" size={14}/>
                    Dummy data
                </button>
                {adding && (
                    <button className={controls.btn} title="Fill the new row with made-up values" onClick={() => void oneDummyRow(database, table).then(setDraft)}>
                        Auto fill
                    </button>
                )}
                <button className={cx(controls.btn, controls.btnPrimary)} disabled={table.columns.length === 0} onClick={() => setAdding(!adding)}>
                    <CosmosIcon name="plus" size={14}/>
                    Add {(terms?.row ?? "row").toLowerCase()}
                </button>
            </div>

            {state.error && <div className={styles.error}>{state.error}</div>}

            <div className={styles.scroll}>
                {table.columns.length === 0 ? (
                    <EmptyState icon="table" title="This table has no columns" text="Add columns in the Structure tab, then come back to add data."/>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.check}><input type="checkbox" checked={allSelected} onChange={toggleAllRows} aria-label="Select all"/></th>
                                {table.columns.map((column) => (
                                    <th key={column.id}>
                                        <span className={styles.name}>{column.name}</span>
                                        <span className={styles.type}>{column.type}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {adding && (
                                <tr className={styles.newRow}>
                                    <td className={styles.check}>
                                        <button className={controls.iconBtn} aria-label="Save row" title="Save row" onClick={() => void submit()}>
                                            <CosmosIcon name="check" size={14}/>
                                        </button>
                                    </td>
                                    {table.columns.map((column) => (
                                        <td key={column.id}>
                                            <input
                                                className={styles.cellInput} value={draft[column.name] ?? ""}
                                                placeholder={column.autoIncrement ? (autoMode(column.type) === "id" ? "new uuid" : "automatic") : column.default || (column.nullable ? "optional" : "")}
                                                onChange={(event) => setDraft({...draft, [column.name]: event.target.value})}
                                                onKeyDown={(event) => event.key === "Enter" && void submit()}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            )}
                            {page?.rows.map((row) => (
                                <tr key={row._rid} className={cx(state.selected.includes(row._rid) && styles.selected)}>
                                    <td className={styles.check}>
                                        <input type="checkbox" checked={state.selected.includes(row._rid)} onChange={() => toggleRow(row._rid)} aria-label="Select row"/>
                                    </td>
                                    {table.columns.map((column) => (
                                        <td key={column.id}>
                                            <Cell column={column} row={row} onSave={(value) => void updateCell(database, table.id, row._rid, {[column.name]: value})}/>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {page && page.rows.length === 0 && !adding && table.columns.length > 0 && (
                    <p className={styles.none}>No {(terms?.rows ?? "rows").toLowerCase()} yet. Press "Add {(terms?.row ?? "row").toLowerCase()}".</p>
                )}
            </div>

            {total > perPage && (
                <div className={styles.pager}>
                    <button className={controls.btn} disabled={offset === 0} onClick={() => void loadRows(database.id, table.id, Math.max(0, offset - perPage))}>Previous</button>
                    <span>{offset + 1}-{Math.min(total, offset + perPage)} of {total}</span>
                    <button className={controls.btn} disabled={offset + perPage >= total} onClick={() => void loadRows(database.id, table.id, offset + perPage)}>Next</button>
                </div>
            )}
        </div>
    );
}
