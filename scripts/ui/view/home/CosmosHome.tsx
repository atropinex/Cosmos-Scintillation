import {useEffect, useState, type MouseEvent as ReactMouseEvent} from "react";
import type {RecentProject} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {showMenuAtEvent} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import {goHome, loadRecents, openProjectDialog, openRecent, removeRecent, revealProject, useRecents} from "../../controller/project/CosmosProject.Controller";
import {useDocument} from "../../controller/document/CosmosDocument.Controller";
import {setView} from "../../controller/view/CosmosView.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon, {type IconName} from "../shared/CosmosIcon";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosNewProject from "./CosmosNewProject";
import styles from "./CosmosHome.module.css";

const KIND_ICON: Record<RecentProject["kind"], IconName> = {database: "database", api: "flow", both: "schema"};
const KIND_LABEL: Record<RecentProject["kind"], string> = {database: "Database", api: "API", both: "Database and API"};

function formatDate(iso: string): string {
    if (!iso) {
        return "";
    }
    return new Date(iso).toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"});
}

/** The first page: your projects, and the buttons to start or open one. */
export default function CosmosHome() {
    const recents = useRecents();
    const {project} = useDocument();
    const [creating, setCreating] = useState(false);

    // The list is read again every time this page opens, so a project made a moment ago is always there.
    useEffect(() => {
        void loadRecents();
    }, []);

    const menuFor = (event: ReactMouseEvent, item: RecentProject) => showMenuAtEvent(event, [
        {label: "Open", disabled: !item.exists, onSelect: () => void openRecent(item.path)},
        {label: "Show in folder", onSelect: () => void revealProject(item.path)},
        "separator",
        {label: "Remove from list", hint: "keeps files", danger: true, confirm: true, onSelect: () => void removeRecent(item.path)}
    ]);

    return (
        <div className={styles.home}>
            <header className={styles.bar}>
                <h1 className={styles.title}>Projects</h1>
                <span className={styles.spacer}/>
                <button className={controls.btn} onClick={() => void openProjectDialog()}>
                    <CosmosIcon name="folder" size={15}/>
                    Open project
                </button>
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => setCreating(true)}>
                    <CosmosIcon name="plus" size={15}/>
                    New project
                </button>
            </header>

            <div className={styles.main}>
                {project && (
                    <div className={styles.current}>
                        <span className={styles.currentText}>
                            <b>{project.name}</b> is open.
                        </span>
                        <button className={controls.btn} onClick={() => setView("workspace")}>Continue</button>
                        <button className={controls.btn} onClick={() => void goHome()}>Close project</button>
                    </div>
                )}

                {recents.length === 0 ? (
                    <EmptyState
                        icon="database"
                        title="Start your first project"
                        text="Design a database, build an API with blocks, or both. Everything is saved in one folder on your computer."
                        action={{label: "New project", onClick: () => setCreating(true)}}
                    />
                ) : (
                    <>
                        <h2 className={styles.heading}>Recent</h2>
                        <div className={styles.grid}>
                            {recents.map((item, index) => (
                                <button
                                    key={item.path}
                                    className={cx(styles.card, !item.exists && styles.missing)}
                                    style={{animationDelay: `calc(${Math.min(index, 12)} * var(--t-fast) * 0.3)`}}
                                    onClick={() => void openRecent(item.path)}
                                    onContextMenu={(event) => menuFor(event, item)}
                                >
                                    <span className={styles.preview}>
                                        {item.exists && (item.preview.tables.length > 0 || item.preview.apis.length > 0) ? (
                                            <>
                                                {item.preview.tables.map((table) => (
                                                    <span key={table.name} className={styles.chip}>
                                                        <CosmosIcon name="database" size={11}/>
                                                        <span className={styles.chipName}>{table.name}</span>
                                                        <span className={styles.chipCount}>{table.columns}</span>
                                                    </span>
                                                ))}
                                                {item.preview.apis.map((api) => (
                                                    <span key={api} className={cx(styles.chip, styles.chipApi)}>
                                                        <CosmosIcon name="flow" size={11}/>
                                                        <span className={styles.chipName}>{api}</span>
                                                    </span>
                                                ))}
                                            </>
                                        ) : (
                                            <span className={styles.previewEmpty}><CosmosIcon name={KIND_ICON[item.kind]} size={24}/></span>
                                        )}
                                    </span>
                                    <span className={styles.name}>{item.name}</span>
                                    <span className={styles.meta}>
                                        {item.exists
                                            ? `${KIND_LABEL[item.kind]} · ${item.databaseCount} db · ${item.apiCount} API`
                                            : "File not found. Right click to remove."}
                                    </span>
                                    {item.exists && <span className={styles.date}>{formatDate(item.updatedAt)}</span>}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <CosmosNewProject open={creating} onClose={() => setCreating(false)}/>
        </div>
    );
}
