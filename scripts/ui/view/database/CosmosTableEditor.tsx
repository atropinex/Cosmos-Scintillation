import {autoMode} from "../../../common/utils/ColumnHelper";
import {useState} from "react";
import type {CosmosColumn, CosmosDatabase, CosmosTable} from "../../../common/CommonInterface";
import {REFERENCE_ACTIONS} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {addColumn, deleteColumn, deleteTable, getEngineOf, moveColumn, patchColumn, renameTable} from "../../controller/database/CosmosDatabase.Controller";
import {selectInSchema, useSchemaSelection} from "../../controller/database/CosmosSchema.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosTableEditor.module.css";

interface ColumnRowProps {
    database: CosmosDatabase;
    table: CosmosTable;
    column: CosmosColumn;
    first: boolean;
    last: boolean;
}

function ColumnRow({database, table, column, first, last}: ColumnRowProps) {
    const engine = getEngineOf(database);
    const selection = useSchemaSelection();
    const [open, setOpen] = useState(false);
    const patch = (change: Partial<CosmosColumn>, key = "") => patchColumn(database.id, table.id, column.id, change, key);
    const relations = engine?.relations ?? false;
    const targets = database.tables.flatMap((item) => item.columns.map((target) => ({table: item, column: target})));

    return (
        <div className={cx(styles.column, selection.columnId === column.id && styles.picked)} onClick={() => selectInSchema(table.id, column.id)}>
            <div className={styles.line}>
                <input
                    className={styles.input} value={column.name} maxLength={60} aria-label="Name"
                    onChange={(event) => patch({name: event.target.value}, `name-${column.id}`)}
                />
                <select className={styles.select} value={column.type} aria-label="Type" onChange={(event) => patch({type: event.target.value})}>
                    {engine?.types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                    {!engine?.types.some((type) => type.id === column.type) && <option value={column.type}>{column.type}</option>}
                </select>
                <button className={controls.iconBtn} aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}>
                    <CosmosIcon name={open ? "chevronDown" : "chevronRight"} size={14}/>
                </button>
            </div>

            <div className={styles.chips}>
                <button className={cx(styles.chip, column.primary && styles.on)} onClick={() => patch({primary: !column.primary})}>Key</button>
                <button className={cx(styles.chip, column.unique && styles.on)} onClick={() => patch({unique: !column.unique})}>Unique</button>
                <button
                    className={cx(styles.chip, column.nullable && styles.on)} disabled={column.primary}
                    onClick={() => patch({nullable: !column.nullable})}
                >
                    Can be empty
                </button>
                {column.ref && <span className={styles.linked}><CosmosIcon name="link" size={11}/> linked</span>}
            </div>

            {open && (
                <div className={styles.more}>
                    <label className={styles.field}>
                        <span>Default value</span>
                        <input className={styles.input} value={column.default} maxLength={200} onChange={(event) => patch({default: event.target.value}, `default-${column.id}`)}/>
                    </label>
                    <label className={styles.check}>
                        <input type="checkbox" checked={column.autoIncrement} onChange={(event) => patch({autoIncrement: event.target.checked})}/>
                        {autoMode(column.type) === "count" ? "Count up automatically" : "Create a unique id (uuid) automatically"}
                    </label>
                    {relations && (
                        <>
                            <label className={styles.field}>
                                <span>Points at</span>
                                <select
                                    className={styles.select}
                                    value={column.ref ? `${column.ref.tableId}|${column.ref.columnId}` : ""}
                                    onChange={(event) => {
                                        const [tableId, columnId] = event.target.value.split("|");
                                        patch({ref: tableId ? {tableId, columnId, onDelete: column.ref?.onDelete ?? "no action"} : null});
                                    }}
                                >
                                    <option value="">Nothing</option>
                                    {targets.filter((target) => target.column.id !== column.id).map((target) => (
                                        <option key={target.column.id} value={`${target.table.id}|${target.column.id}`}>{target.table.name}.{target.column.name}</option>
                                    ))}
                                </select>
                            </label>
                            {column.ref && (
                                <label className={styles.field}>
                                    <span>When that row is deleted</span>
                                    <select
                                        className={styles.select} value={column.ref.onDelete}
                                        onChange={(event) => patch({ref: {...column.ref!, onDelete: event.target.value as typeof REFERENCE_ACTIONS[number]}})}
                                    >
                                        {REFERENCE_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
                                    </select>
                                </label>
                            )}
                        </>
                    )}
                    <div className={styles.actions}>
                        <button className={controls.btn} disabled={first} onClick={() => moveColumn(database.id, table.id, column.id, -1)}><CosmosIcon name="up" size={13}/> Up</button>
                        <button className={controls.btn} disabled={last} onClick={() => moveColumn(database.id, table.id, column.id, 1)}><CosmosIcon name="down" size={13}/> Down</button>
                        <button className={cx(controls.btn, controls.btnDanger)} onClick={() => void deleteColumn(database.id, table.id, column.id)}>
                            <CosmosIcon name="trash" size={13}/> Delete
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

interface CosmosTableEditorProps {
    database: CosmosDatabase;
    table: CosmosTable;
}

/** The panel on the right of the diagram: rename the table, edit its columns and what they point at. */
export default function CosmosTableEditor({database, table}: CosmosTableEditorProps) {
    const terms = getEngineOf(database)?.terms;

    return (
        <aside className={styles.panel}>
            <div className={styles.top}>
                <input
                    className={cx(styles.input, styles.title)} value={table.name} maxLength={60} aria-label={`${terms?.container ?? "Table"} name`}
                    onChange={(event) => renameTable(database.id, table.id, event.target.value)}
                />
                <button className={cx(controls.iconBtn, controls.btnDanger)} title={`Delete ${terms?.container.toLowerCase() ?? "table"}`} aria-label="Delete" onClick={() => void deleteTable(database.id, table.id)}>
                    <CosmosIcon name="trash" size={15}/>
                </button>
            </div>

            <div className={styles.list}>
                {table.columns.map((column, index) => (
                    <ColumnRow key={column.id} database={database} table={table} column={column} first={index === 0} last={index === table.columns.length - 1}/>
                ))}
                {table.columns.length === 0 && <p className={styles.empty}>No {terms?.fields.toLowerCase() ?? "columns"} yet.</p>}
            </div>

            <div className={styles.foot}>
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => addColumn(database, table)}>
                    <CosmosIcon name="plus" size={14}/>
                    Add {terms?.field.toLowerCase() ?? "column"}
                </button>
            </div>
        </aside>
    );
}
