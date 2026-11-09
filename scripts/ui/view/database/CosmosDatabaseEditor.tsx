import {useEffect, useState} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {clearRows} from "../../controller/database/CosmosRows.Controller";
import {clearSchemaSelection, useSchemaSelection} from "../../controller/database/CosmosSchema.Controller";
import {addTable, getEngineOf} from "../../controller/database/CosmosDatabase.Controller";
import {useDatabase} from "../../controller/document/CosmosDocument.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosIcon from "../shared/CosmosIcon";
import CosmosDataGrid from "./CosmosDataGrid";
import CosmosDatabaseExport from "./CosmosDatabaseExport";
import CosmosDatabaseTest from "./CosmosDatabaseTest";
import CosmosSchemaDiagram from "./CosmosSchemaDiagram";
import CosmosTableEditor from "./CosmosTableEditor";
import styles from "./CosmosDatabaseEditor.module.css";

type Tab = "structure" | "data" | "test" | "export";
const TABS: Array<{id: Tab; label: string}> = [{id: "structure", label: "Structure"}, {id: "data", label: "Data"}, {id: "test", label: "Test"}, {id: "export", label: "Export"}];

interface CosmosDatabaseEditorProps {
    databaseId: string;
}

/** One database: its structure drawn as a diagram, its data as a grid, and the script that creates it. */
export default function CosmosDatabaseEditor({databaseId}: CosmosDatabaseEditorProps) {
    const database = useDatabase(databaseId);
    const selection = useSchemaSelection();
    const [tab, setTab] = useState<Tab>("structure");

    // Leaving the Data tab frees the page of rows that was read from disk.
    useEffect(() => {
        if (tab !== "data") {
            clearRows();
        }
    }, [tab]);
    useEffect(() => () => {
        clearRows();
        clearSchemaSelection();
    }, [databaseId]);

    if (!database) {
        return null;
    }

    const engine = getEngineOf(database);
    const terms = engine?.terms;
    const table = database.tables.find((item) => item.id === selection.tableId);

    return (
        <div className={styles.editor}>
            <header className={styles.bar}>
                <div className={styles.titleBlock}>
                    <h2 className={styles.title}>{database.name}</h2>
                    <span className={styles.engine}>{engine?.name ?? database.engine}</span>
                </div>
                <div className={controls.segmented} role="tablist">
                    {TABS.map((item) => (
                        <button
                            key={item.id} role="tab" aria-selected={tab === item.id}
                            className={cx(controls.segment, tab === item.id && controls.selected)}
                            onClick={() => setTab(item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <span className={styles.grow}/>
                {tab === "structure" && (
                    <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => addTable(database)}>
                        <CosmosIcon name="plus" size={15}/>
                        New {terms?.container.toLowerCase() ?? "table"}
                    </button>
                )}
            </header>

            <div className={styles.body}>
                {tab === "structure" && (
                    database.tables.length === 0 ? (
                        <EmptyState
                            icon="table"
                            title={`No ${terms?.containers.toLowerCase() ?? "tables"} yet`}
                            text="Add your first one. You can draw lines between them to show how they are connected."
                            action={{label: `New ${terms?.container.toLowerCase() ?? "table"}`, onClick: () => addTable(database)}}
                        />
                    ) : (
                        <>
                            <CosmosSchemaDiagram database={database}/>
                            {table && <CosmosTableEditor key={table.id} database={database} table={table}/>}
                        </>
                    )
                )}
                {tab === "data" && <CosmosDataGrid database={database}/>}
                {tab === "test" && <CosmosDatabaseTest database={database}/>}
                {tab === "export" && <CosmosDatabaseExport database={database}/>}
            </div>
        </div>
    );
}
