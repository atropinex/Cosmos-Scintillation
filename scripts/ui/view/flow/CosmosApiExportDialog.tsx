import {useEffect, useState} from "react";
import type {ApiExportPreview, CosmosApi, CosmosDatabase} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {changeProject, getProject} from "../../controller/document/CosmosDocument.Controller";
import {getLanguage} from "../../controller/registry/CosmosRegistry.Controller";
import {showToast} from "../../controller/toast/CosmosToast.Controller";
import CosmosModal from "../modal/CosmosModal";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosApiExportDialog.module.css";

interface CosmosApiExportDialogProps {
    open: boolean;
    api: CosmosApi;
    database: CosmosDatabase | undefined;
    onClose: () => void;
}

const LEVEL_ICON = {ok: "check", warn: "warning", risk: "warning"} as const;

/** Shows what will be written (files, security checks, notes) before anything touches the disk. */
export default function CosmosApiExportDialog({open, api, database, onClose}: CosmosApiExportDialogProps) {
    const [preview, setPreview] = useState<ApiExportPreview | null>(null);
    const [error, setError] = useState("");
    const [chosen, setChosen] = useState(0);
    const [busy, setBusy] = useState(false);
    const language = getLanguage(api.language);

    useEffect(() => {
        if (!open) {
            setPreview(null);
            setError("");
            setChosen(0);
            return;
        }
        let current = true;
        const project = getProject();
        window.api.previewApiExport(api, database ?? null, project?.name ?? "project")
            .then((result) => current && setPreview(result))
            .catch((problem: Error) => current && setError(problem.message));
        return () => {
            current = false;
        };
        // The preview is made when the dialog opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const problems = preview?.notes.filter((note) => note.startsWith("Problem")) ?? [];
    const notes = preview?.notes.filter((note) => !note.startsWith("Problem")) ?? [];
    const file = preview?.files[chosen];

    const write = async () => {
        const project = getProject();
        if (!project || busy) {
            return;
        }
        setBusy(true);
        try {
            const result = await window.api.writeApiExport(api, database ?? null, project.name, project.export.lastFolder);
            if (result.ok && result.folder) {
                changeProject((current) => ({...current, export: {...current.export, lastFolder: result.folder!}}));
                showToast(`Saved ${result.fileCount} files. Open README.md to run the API.`);
                onClose();
            } else if (!result.cancelled) {
                setError(result.error ?? "The files could not be saved.");
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <CosmosModal
            open={open} title={`Export "${api.name}"`} width={900} onClose={onClose}
            footer={
                <>
                    <button className={controls.btn} onClick={onClose}>Close</button>
                    <button className={cx(controls.btn, controls.btnPrimary)} disabled={!preview || problems.length > 0 || busy} onClick={() => void write()}>
                        <CosmosIcon name="export" size={14}/> Save to a folder
                    </button>
                </>
            }
        >
            <p className={styles.summary}>
                <b>{language?.name ?? api.language}</b>
                {api.packages.length > 0 && <> with {api.packages.join(", ")}</>}
                {language && <span className={styles.muted}> · needs {language.runtime}, start with <code>{language.runCommand}</code></span>}
            </p>

            {error && <p className={styles.bad}>{error}</p>}
            {!preview && !error && <p className={styles.muted}>Preparing...</p>}
            {problems.map((problem) => <p key={problem} className={styles.bad}><CosmosIcon name="warning" size={13}/> {problem}</p>)}

            {preview && (
                <>
                    <h4 className={styles.heading}>Security</h4>
                    <ul className={styles.findings}>
                        {preview.security.map((finding) => (
                            <li key={finding.message} className={styles[finding.level]}>
                                <CosmosIcon name={LEVEL_ICON[finding.level]} size={13}/> {finding.message}
                            </li>
                        ))}
                    </ul>
                    {notes.map((note) => <p key={note} className={styles.muted}>{note}</p>)}

                    <h4 className={styles.heading}>Files ({preview.files.length})</h4>
                    <div className={styles.files}>
                        <div className={styles.names}>
                            {preview.files.map((item, index) => (
                                <button key={item.path} className={cx(styles.name, index === chosen && styles.picked)} onClick={() => setChosen(index)}>{item.path}</button>
                            ))}
                        </div>
                        <pre className={styles.code}>{file?.content}</pre>
                    </div>
                </>
            )}
        </CosmosModal>
    );
}
