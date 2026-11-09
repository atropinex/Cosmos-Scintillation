import {useState} from "react";
import type {CosmosDatabase, DatabaseCheckResult, RowFilterOp, RowQueryResult} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {useDocument} from "../../controller/document/CosmosDocument.Controller";
import {hintsForTable} from "../../controller/json/CosmosJsonHint.Controller";
import CosmosJsonEditor from "../shared/CosmosJsonEditor";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import {EmptyState} from "../shared/CosmosEmpty";
import styles from "./CosmosDatabaseTest.module.css";

interface CosmosDatabaseTestProps {
    database: CosmosDatabase;
}

const OPERATORS: Array<{value: RowFilterOp; label: string}> = [
    {value: "eq", label: "is"}, {value: "ne", label: "is not"}, {value: "contains", label: "contains"},
    {value: "lt", label: "is less than"}, {value: "gt", label: "is more than"}, {value: "empty", label: "is empty"}
];

/** Three small tools: look rows up, try a row against the rules, and check every row of the database. Nothing here saves data. */
export default function CosmosDatabaseTest({database}: CosmosDatabaseTestProps) {
    const {path} = useDocument();
    const [tableId, setTableId] = useState(database.tables[0]?.id ?? "");
    const table = database.tables.find((item) => item.id === tableId) ?? database.tables[0];

    const [columnId, setColumnId] = useState("");
    const [op, setOp] = useState<RowFilterOp>("contains");
    const [value, setValue] = useState("");
    const [found, setFound] = useState<RowQueryResult | null>(null);

    const [rowText, setRowText] = useState("");
    const [verdict, setVerdict] = useState<{ok: boolean; message: string} | null>(null);

    const [report, setReport] = useState<DatabaseCheckResult | null>(null);
    const [busy, setBusy] = useState(false);

    if (!table || !path) {
        return <EmptyState icon="table" title="Nothing to test yet" text="Add a table and some rows first."/>;
    }
    const column = table.columns.find((item) => item.id === columnId) ?? table.columns[0];

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } finally {
            setBusy(false);
        }
    };

    const example = () => Object.fromEntries(table.columns.filter((item) => !item.autoIncrement).map((item) => [item.name, ""]));

    return (
        <div className={styles.test}>
            <label className={styles.pick}>Table
                <select className={controls.field} value={table.id} onChange={(e) => { setTableId(e.target.value); setColumnId(""); setFound(null); setVerdict(null); }}>
                    {database.tables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>

            <section className={styles.card}>
                <h3>Look up rows</h3>
                <div className={styles.line}>
                    <select className={controls.field} value={column?.id} aria-label="Column" onChange={(e) => setColumnId(e.target.value)}>
                        {table.columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select className={controls.field} value={op} aria-label="Condition" onChange={(e) => setOp(e.target.value as RowFilterOp)}>
                        {OPERATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    {op !== "empty" && <input className={controls.field} value={value} placeholder="value" onChange={(e) => setValue(e.target.value)}/>}
                    <button
                        className={cx(controls.btn, controls.btnPrimary)} disabled={busy}
                        onClick={() => void run(async () => setFound(await window.api.queryRows(path, database, {tableId: table.id, columnId: column?.id ?? "", op, value})))}
                    >
                        <CosmosIcon name="search" size={13}/> Search
                    </button>
                </div>
                {found && (found.ok ? (
                    <>
                        <p className={styles.note}>{found.rows.length} row{found.rows.length === 1 ? "" : "s"} found{found.more ? " (more exist, showing the first ones)" : ""}, {found.scanned} read.</p>
                        {found.rows.length > 0 && (
                            <div className={styles.scroll}>
                                <table className={controls.table}>
                                    <thead><tr>{table.columns.map((item) => <th key={item.id}>{item.name}</th>)}</tr></thead>
                                    <tbody>{found.rows.map((row) => (
                                        <tr key={row._rid}>{table.columns.map((item) => <td key={item.id}>{row[item.id] === null || row[item.id] === undefined ? <i>empty</i> : String(row[item.id])}</td>)}</tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        )}
                    </>
                ) : <p className={styles.bad}>{found.error}</p>)}
            </section>

            <section className={styles.card}>
                <h3>Try a row</h3>
                <CosmosJsonEditor value={rowText} onChange={setRowText} hints={hintsForTable(table)} placeholder={JSON.stringify(example())} ariaLabel="Row"/>
                <div className={styles.line}>
                    <button
                        className={controls.btn} disabled={busy}
                        onClick={() => void run(async () => {
                            try {
                                setVerdict(await window.api.checkRow(database, table.id, JSON.parse(rowText || "{}")));
                            } catch {
                                setVerdict({ok: false, message: "That is not valid JSON."});
                            }
                        })}
                    >
                        Check the row
                    </button>
                    {verdict && <span className={verdict.ok ? styles.good : styles.bad}>{verdict.message}</span>}
                </div>
            </section>

            <section className={styles.card}>
                <h3>Check everything</h3>
                <p className={styles.note}>Looks for missing required values, repeated unique values, and references that point at rows that do not exist.</p>
                <div className={styles.line}>
                    <button className={controls.btn} disabled={busy} onClick={() => void run(async () => setReport(await window.api.checkDatabase(path, database)))}>
                        Run the check
                    </button>
                    {report && <span className={report.ok ? styles.good : styles.bad}>{report.ok ? `All good: ${report.rowsChecked} rows checked.` : `${report.issues.length}${report.more ? "+" : ""} problem${report.issues.length === 1 ? "" : "s"} in ${report.rowsChecked} rows.`}</span>}
                </div>
                {report && report.issues.length > 0 && (
                    <ul className={styles.issues}>
                        {report.issues.map((issue, index) => <li key={index}><b>{issue.tableName}</b> row {issue.row}: {issue.message}</li>)}
                    </ul>
                )}
            </section>
        </div>
    );
}
