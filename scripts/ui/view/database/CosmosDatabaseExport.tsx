import {useEffect, useState} from "react";
import type {CosmosDatabase} from "../../../common/CommonInterface";
import type {GeneratedOutput} from "../../../common/exporters/ExportTypes";
import {cx} from "../../../common/utils/ClassHelper";
import {changeProject, getProject} from "../../controller/document/CosmosDocument.Controller";
import {showToast} from "../../controller/toast/CosmosToast.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosDatabaseExport.module.css";

interface CosmosDatabaseExportProps {
    database: CosmosDatabase;
}

/** Shows the script that creates the database in the real engine, and saves it to a folder. */
export default function CosmosDatabaseExport({database}: CosmosDatabaseExportProps) {
    const [output, setOutput] = useState<GeneratedOutput | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let current = true;
        void window.api.previewDatabaseExport(database).then((result) => current && setOutput(result));
        return () => {
            current = false;
        };
    }, [database]);

    const write = async () => {
        const project = getProject();
        if (!project || busy) {
            return;
        }
        setBusy(true);
        try {
            const result = await window.api.writeDatabaseExport(database, project.name, project.export.lastFolder);
            if (result.ok && result.folder) {
                changeProject((current) => ({...current, export: {...current.export, lastFolder: result.folder!}}));
                showToast(`Saved ${result.fileCount} file${result.fileCount === 1 ? "" : "s"}`);
            } else if (!result.cancelled) {
                showToast(result.error ?? "Could not save the file.", true);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.export}>
            <div className={styles.bar}>
                <span className={styles.text}>The script that creates this database. Run it in your database program.</span>
                <button className={cx(controls.btn, controls.btnPrimary)} disabled={!output?.files.length || busy} onClick={() => void write()}>
                    <CosmosIcon name="export" size={14}/>
                    Save to a folder
                </button>
            </div>
            {output?.notes.map((note) => <p key={note} className={styles.note}><CosmosIcon name="warning" size={13}/> {note}</p>)}
            {output?.files.map((file) => (
                <div key={file.path} className={styles.file}>
                    <div className={styles.name}>{file.path}</div>
                    <pre className={styles.code}>{file.content}</pre>
                </div>
            ))}
        </div>
    );
}
