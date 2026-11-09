import {useEffect} from "react";
import {EXTENSION_KINDS} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {
    installExtension, loadExtensions, openExtensionsFolder, openRegistryFolder, removeExtension, restoreBuiltIns, setEnabled, useExtensions
} from "../../controller/extension/CosmosExtension.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosExtensions.module.css";

/**
 * Extensions add database engines, API languages, script nodes, launcher services and themes. They are plain YAML
 * files and never run code inside the app.
 */
export default function CosmosExtensions() {
    const {extensions} = useExtensions();

    useEffect(() => {
        void loadExtensions();
    }, []);

    return (
        <div className={styles.page}>
            <header className={styles.bar}>
                <h1 className={styles.title}>Extensions</h1>
                <span className={styles.sub}>Add engines, languages, nodes, services and themes</span>
                <span className={styles.grow}/>
                <button className={controls.btn} onClick={() => void openExtensionsFolder()}><CosmosIcon name="folder" size={14}/> Open folder</button>
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => void installExtension()}>
                    <CosmosIcon name="plus" size={14}/> Install from folder
                </button>
            </header>

            <div className={styles.body}>
                {extensions.length === 0 ? (
                    <EmptyState
                        icon="puzzle"
                        title="No extensions installed"
                        text="An extension is a folder with an extension.yaml file. Install one, or copy a folder into the extensions folder."
                        action={{label: "Install from folder", onClick: () => void installExtension()}}
                    />
                ) : (
                    extensions.map((extension, index) => (
                        <div key={extension.id} className={styles.card} style={{animationDelay: `calc(${Math.min(index, 10)} * var(--t-fast) * 0.3)`}}>
                            <div className={styles.head}>
                                <div className={styles.names}>
                                    <span className={styles.name}>{extension.name}</span>
                                    <span className={styles.meta}>v{extension.version} · {extension.author || "unknown author"}</span>
                                </div>
                                <button
                                    type="button" role="switch" aria-checked={extension.enabled} aria-label={extension.enabled ? "Turn off" : "Turn on"}
                                    className={controls.switch} onClick={() => void setEnabled(extension.id, !extension.enabled)}
                                />
                                <button className={cx(controls.iconBtn, controls.btnDanger)} aria-label="Remove" title="Remove" onClick={() => void removeExtension(extension.id)}>
                                    <CosmosIcon name="trash" size={15}/>
                                </button>
                            </div>
                            {extension.description && <p className={styles.desc}>{extension.description}</p>}
                            <div className={styles.tags}>
                                {EXTENSION_KINDS.filter((kind) => (extension.contributes[kind] ?? 0) > 0).map((kind) => (
                                    <span key={kind} className={controls.tag}>{extension.contributes[kind]} {kind}</span>
                                ))}
                            </div>
                            {extension.problems.map((problem) => <p key={problem} className={styles.problem}><CosmosIcon name="warning" size={13}/> {problem}</p>)}
                        </div>
                    ))
                )}

                <div className={styles.tools}>
                    <button className={controls.btn} onClick={() => void openRegistryFolder()}>Open the files of engines, languages and nodes</button>
                    <button className={controls.btn} onClick={() => void restoreBuiltIns()}>Restore built-in files</button>
                </div>
            </div>
        </div>
    );
}
