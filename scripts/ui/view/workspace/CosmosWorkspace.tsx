import {lazy, Suspense, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {showMenuAtEvent} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import {goHome} from "../../controller/project/CosmosProject.Controller";
import {
    addApi, addDatabase, addEmptyLink, defaultLanguage, deleteApi, deleteDatabase, deleteLink, duplicateApi, duplicateDatabase,
    duplicateLink, importLink, importScript, renameApi, renameDatabase, renameLink
} from "../../controller/project/CosmosProjectItems.Controller";
import {useProject} from "../../controller/document/CosmosDocument.Controller";
import {useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import {select, useSelection, type WorkspaceSection} from "../../controller/view/CosmosView.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosIcon, {type IconName} from "../shared/CosmosIcon";
import CosmosSaveStatus from "./CosmosSaveStatus";
import styles from "./CosmosWorkspace.module.css";

// Each editor is only loaded when one is opened.
const CosmosDatabaseEditor = lazy(() => import("../database/CosmosDatabaseEditor"));
const CosmosApiEditor = lazy(() => import("../flow/CosmosApiEditor"));
const CosmosLinkEditor = lazy(() => import("../links/CosmosLinkEditor"));

interface ItemProps {
    section: WorkspaceSection;
    id: string;
    name: string;
    icon: IconName;
    active: boolean;
    onRename: (name: string) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}

/** One row of the list. Double click renames it, right click shows the other actions. */
function Item({section, id, name, icon, active, onRename, onDuplicate, onDelete}: ItemProps) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(name);

    const finish = (save: boolean) => {
        setEditing(false);
        if (save && text.trim() && text.trim() !== name) {
            onRename(text.trim());
        }
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            finish(true);
        } else if (event.key === "Escape") {
            finish(false);
        }
    };
    const startRename = () => {
        setText(name);
        setEditing(true);
    };
    const menu = (event: ReactMouseEvent) => showMenuAtEvent(event, [
        {label: "Rename", onSelect: startRename},
        {label: "Duplicate", onSelect: onDuplicate},
        "separator",
        {label: "Delete", danger: true, onSelect: onDelete}
    ]);

    return (
        <div
            className={cx(styles.item, active && styles.active)}
            onClick={() => select(section, id)}
            onDoubleClick={startRename}
            onContextMenu={menu}
        >
            <CosmosIcon name={icon} size={15}/>
            {editing ? (
                <input
                    className={styles.rename}
                    autoFocus
                    value={text}
                    maxLength={60}
                    onChange={(event) => setText(event.target.value)}
                    onBlur={() => finish(true)}
                    onKeyDown={onKey}
                    onClick={(event) => event.stopPropagation()}
                />
            ) : (
                <span className={styles.itemName}>{name}</span>
            )}
        </div>
    );
}

interface HeadProps {
    title: string;
    onAdd: (event: ReactMouseEvent) => void;
}

function Head({title, onAdd}: HeadProps) {
    return (
        <div className={styles.head}>
            <span>{title}</span>
            <button className={controls.iconBtn} aria-label={`Add to ${title}`} title="Add" onClick={onAdd}>
                <CosmosIcon name="plus" size={14}/>
            </button>
        </div>
    );
}

/** The open project: a list on the left, and the editor of the chosen item on the right. */
export default function CosmosWorkspace() {
    const project = useProject();
    const selection = useSelection();
    const {engines} = useRegistries();

    if (!project) {
        return null;
    }

    const addDatabaseMenu = (event: ReactMouseEvent) => showMenuAtEvent(event, engines.map((engine) => ({
        label: engine.name,
        hint: engine.family,
        onSelect: () => addDatabase("database", engine.id)
    })));
    const addApiMenu = (event: ReactMouseEvent) => showMenuAtEvent(event, [
        {label: "REST API (one route)", onSelect: () => addApi("api", defaultLanguage(), project.databases[0]?.id ?? "")},
        {label: "WebSocket server (chat)", onSelect: () => addApi("socket", defaultLanguage(), project.databases[0]?.id ?? "", "websocket")},
        ...(project.databases[0]?.tables ?? []).slice(0, 12).map((table) => ({
            label: `REST API for "${table.name}"`,
            hint: "list, read, create, change, delete",
            onSelect: () => addApi(table.name, defaultLanguage(), project.databases[0].id, "crud", table.id)
        })),
        "separator",
        {label: "Import a script file...", onSelect: () => void importScript()}
    ]);
    const addLinkMenu = (event: ReactMouseEvent) => showMenuAtEvent(event, [
        {label: "REST API", onSelect: () => addEmptyLink("rest")},
        {label: "WebSocket", onSelect: () => addEmptyLink("websocket")},
        "separator",
        {label: "Import OpenAPI / AsyncAPI file...", onSelect: () => void importLink()}
    ]);

    const hasSelection = selection.section !== null && (
        (selection.section === "database" && project.databases.some((item) => item.id === selection.id)) ||
        (selection.section === "api" && project.apis.some((item) => item.id === selection.id)) ||
        (selection.section === "link" && project.links.some((item) => item.id === selection.id))
    );

    return (
        <div className={styles.workspace}>
            <aside className={styles.side}>
                <div className={styles.projectBar}>
                    <span className={styles.projectName} title={project.name}>{project.name}</span>
                    <button className={controls.iconBtn} aria-label="Close project" title="Close project" onClick={() => void goHome()}>
                        <CosmosIcon name="close" size={14}/>
                    </button>
                </div>

                <div className={styles.lists}>
                    <Head title="Databases" onAdd={addDatabaseMenu}/>
                    {project.databases.map((item) => (
                        <Item
                            key={item.id} section="database" id={item.id} name={item.name} icon="database"
                            active={selection.section === "database" && selection.id === item.id}
                            onRename={(name) => renameDatabase(item.id, name)}
                            onDuplicate={() => duplicateDatabase(item.id)}
                            onDelete={() => void deleteDatabase(item.id)}
                        />
                    ))}

                    <Head title="APIs" onAdd={addApiMenu}/>
                    {project.apis.map((item) => (
                        <Item
                            key={item.id} section="api" id={item.id} name={item.name} icon="flow"
                            active={selection.section === "api" && selection.id === item.id}
                            onRename={(name) => renameApi(item.id, name)}
                            onDuplicate={() => duplicateApi(item.id)}
                            onDelete={() => void deleteApi(item.id)}
                        />
                    ))}

                    <Head title="Connections" onAdd={addLinkMenu}/>
                    {project.links.map((item) => (
                        <Item
                            key={item.id} section="link" id={item.id} name={item.name} icon={item.kind === "websocket" ? "socket" : "api"}
                            active={selection.section === "link" && selection.id === item.id}
                            onRename={(name) => renameLink(item.id, name)}
                            onDuplicate={() => duplicateLink(item.id)}
                            onDelete={() => void deleteLink(item.id)}
                        />
                    ))}
                </div>

                <div className={styles.foot}><CosmosSaveStatus/></div>
            </aside>

            {/* The key restarts the entrance animation when another item is opened. */}
            <section className={styles.editor} key={`${selection.section}-${selection.id}`}>
                <Suspense fallback={null}>
                    {hasSelection && selection.section === "database" && <CosmosDatabaseEditor databaseId={selection.id}/>}
                    {hasSelection && selection.section === "api" && <CosmosApiEditor apiId={selection.id}/>}
                    {hasSelection && selection.section === "link" && <CosmosLinkEditor linkId={selection.id}/>}
                </Suspense>
                {!hasSelection && (
                    <EmptyState
                        icon="database"
                        title="Pick something on the left"
                        text="Open a database to design its tables, an API to build it with blocks, or a connection to test your own server."
                    />
                )}
            </section>
        </div>
    );
}
