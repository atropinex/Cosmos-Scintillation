import {cx} from "../../../common/utils/ClassHelper";
import {saveNow} from "../../controller/autosave/CosmosAutosave.Controller";
import {useDocument} from "../../controller/document/CosmosDocument.Controller";
import styles from "./CosmosSaveStatus.module.css";

const LABELS = {saved: "Saved", dirty: "Unsaved changes", saving: "Saving...", error: "Not saved"} as const;

/** A small light and word that say whether the project is on disk. Click it to save now. */
export default function CosmosSaveStatus() {
    const {saveState, saveError} = useDocument();

    return (
        <button
            className={cx(styles.status, styles[saveState])}
            title={saveState === "error" ? saveError : "Save now (Ctrl+S)"}
            onClick={() => void saveNow()}
        >
            <span className={styles.light}/>
            {LABELS[saveState]}
        </button>
    );
}
