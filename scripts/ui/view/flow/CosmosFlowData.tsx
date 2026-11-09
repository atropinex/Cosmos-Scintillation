import {useEffect, useState} from "react";
import type {CosmosDatabase, RowData} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {useDocument} from "../../controller/document/CosmosDocument.Controller";
import {addFieldReaders, addNodeAt, setProp, toGraph} from "../../controller/flow/CosmosFlow.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosFlowData.module.css";

interface CosmosFlowDataProps {
    apiId: string;
    database: CosmosDatabase | undefined;
    boardSize: () => {width: number; height: number};
}

const ACTIONS: Array<{kind: string; label: string}> = [
    {kind: "dbFind", label: "Find"}, {kind: "dbInsert", label: "Add"}, {kind: "dbUpdate", label: "Change"}, {kind: "dbDelete", label: "Delete"}
];

/** The API's database next to the board: see its tables and a few rows, pick the columns you want, and add them as blocks. */
export default function CosmosFlowData({apiId, database, boardSize}: CosmosFlowDataProps) {
    const {path} = useDocument();
    const [tableId, setTableId] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [sample, setSample] = useState<RowData[]>([]);
    const table = database?.tables.find((item) => item.id === tableId);

    // Only five rows are read, and only for the table that is open.
    useEffect(() => {
        setPicked([]);
        setSample([]);
        if (!path || !database || !table) {
            return;
        }
        let current = true;
        void window.api.listRows(path, database.id, table.id, 0, 5).then((page) => current && setSample(page.rows)).catch(() => undefined);
        return () => {
            current = false;
        };
    }, [path, database?.id, table?.id]);

    if (!database) {
        return <p className={styles.none}>This API has no database. Choose one in the bar above the board.</p>;
    }
    if (database.tables.length === 0) {
        return <p className={styles.none}>"{database.name}" has no tables yet.</p>;
    }

    const middle = () => {
        const size = boardSize();
        const at = toGraph(size.width / 2, size.height / 2);
        return {x: at.x - 116, y: at.y - 40};
    };
    const add = (kind: string) => {
        if (!table) {
            return;
        }
        const at = middle();
        const id = addNodeAt(apiId, kind, at.x, at.y);
        if (id) {
            setProp(apiId, id, "table", table.name);
        }
    };
    const toggle = (name: string) => setPicked(picked.includes(name) ? picked.filter((item) => item !== name) : [...picked, name]);

    return (
        <div className={styles.data}>
            <div className={styles.head}><CosmosIcon name="database" size={13}/> {database.name}</div>
            {database.tables.map((item) => (
                <div key={item.id}>
                    <button className={cx(styles.table, item.id === tableId && styles.open)} onClick={() => setTableId(item.id === tableId ? "" : item.id)} aria-expanded={item.id === tableId}>
                        <CosmosIcon name="table" size={13}/>
                        <span className={styles.name}>{item.name}</span>
                        <span className={styles.count}>{item.columns.length}</span>
                    </button>

                    {item.id === tableId && (
                        <div className={styles.detail}>
                            <div className={styles.actions}>
                                {ACTIONS.map((action) => (
                                    <button key={action.kind} className={controls.btn} onClick={() => add(action.kind)} title={`Add a block that does "${action.label.toLowerCase()}" on ${item.name}`}>{action.label}</button>
                                ))}
                            </div>

                            <p className={styles.hint}>Tick the columns you want to use.</p>
                            {item.columns.map((column) => (
                                <label key={column.id} className={styles.column}>
                                    <input type="checkbox" checked={picked.includes(column.name)} onChange={() => toggle(column.name)}/>
                                    <span className={styles.name}>{column.name}</span>
                                    {column.primary && <CosmosIcon name="key" size={11}/>}
                                    <span className={styles.type}>{column.type}</span>
                                </label>
                            ))}
                            <button
                                className={cx(controls.btn, controls.btnPrimary, styles.use)} disabled={picked.length === 0}
                                onClick={() => {
                                    const at = middle();
                                    addFieldReaders(apiId, item.name, picked, at.x, at.y);
                                }}
                            >
                                Use {picked.length > 0 ? `${picked.length} ` : ""}selected
                            </button>

                            {sample.length > 0 && (
                                <div className={styles.sample}>
                                    <p className={styles.hint}>First {sample.length} rows</p>
                                    <div className={styles.scroll}>
                                        <table>
                                            <thead><tr>{item.columns.map((column) => <th key={column.id}>{column.name}</th>)}</tr></thead>
                                            <tbody>{sample.map((row) => (
                                                <tr key={row._rid}>{item.columns.map((column) => <td key={column.id} title={String(row[column.id] ?? "")}>{row[column.id] === null || row[column.id] === undefined ? "" : String(row[column.id])}</td>)}</tr>
                                            ))}</tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
