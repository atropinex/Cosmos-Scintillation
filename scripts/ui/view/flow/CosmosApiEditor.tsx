import {useEffect, useMemo, useRef, useState} from "react";
import type {ApiSecurity, CosmosApi} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {redo, undo, updateApi, useApi, useCanRedo, useCanUndo, useProject} from "../../controller/document/CosmosDocument.Controller";
import {addTableRoutes, arrange, clearGraph, fitGraph, openFlow, useFlow} from "../../controller/flow/CosmosFlow.Controller";
import {languagesFitting, neededCapabilities} from "../../controller/flow/CosmosGraph.Controller";
import {showMenuAtEvent} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import {importScript} from "../../controller/project/CosmosProjectItems.Controller";
import {getNodeDefinition, useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import {showToast} from "../../controller/toast/CosmosToast.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import {NumberField, SelectField, TextField, ToggleField} from "../shared/CosmosFields";
import CosmosIcon from "../shared/CosmosIcon";
import CosmosApiExportDialog from "./CosmosApiExportDialog";
import CosmosApiTester from "./CosmosApiTester";
import CosmosFlowCanvas from "./CosmosFlowCanvas";
import CosmosFlowInspector from "./CosmosFlowInspector";
import CosmosFlowPalette from "./CosmosFlowPalette";
import styles from "./CosmosApiEditor.module.css";

interface CosmosApiEditorProps {
    apiId: string;
}

/** The visual script of one API: blocks on a board, and the settings and export on top. */
export default function CosmosApiEditor({apiId}: CosmosApiEditorProps) {
    const api = useApi(apiId);
    const project = useProject();
    const {languages} = useRegistries();
    const {selected} = useFlow();
    const canUndo = useCanUndo();
    const canRedo = useCanRedo();
    const [exporting, setExporting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [panel, setPanel] = useState<"" | "security" | "packages">("");
    const board = useRef<HTMLDivElement>(null);

    useEffect(() => {
        openFlow(apiId);
    }, [apiId]);

    const needed = useMemo(() => (api ? neededCapabilities(api.graph, getNodeDefinition) : []), [api?.graph]);
    const fitting = useMemo(() => languagesFitting(languages, needed), [languages, needed]);

    if (!api) {
        return null;
    }

    const language = languages.find((item) => item.id === api.language);
    const database = project?.databases.find((item) => item.id === api.databaseId);
    const node = api.graph.nodes.find((item) => item.id === selected[0]);
    const patch = (change: Partial<CosmosApi>, key = "") => updateApi(apiId, (current) => ({...current, ...change}), key);
    const patchSecurity = (change: Partial<ApiSecurity>, key = "") => patch({security: {...api.security, ...change}}, key);
    const languageOptions = (fitting.some((item) => item.id === api.language) ? fitting : [...fitting, ...(language ? [language] : [])]).map((item) => ({value: item.id, label: item.name}));
    const toggle = (name: "security" | "packages") => setPanel(panel === name ? "" : name);

    const changeLanguage = (id: string) => {
        const next = languages.find((item) => item.id === id);
        // Packages belong to one language, so they are reset when the language changes.
        patch({language: id, packages: []});
        if (next) {
            showToast(`Now exporting to ${next.name}`);
        }
    };

    const exportScript = async () => {
        const result = await window.api.exportScript(api);
        if (result.ok) {
            showToast("Script saved");
        } else if (!result.cancelled) {
            showToast(result.error ?? "The script could not be saved.", true);
        }
    };

    return (
        <div className={styles.editor}>
            <header className={styles.bar}>
                <h2 className={styles.title}>{api.name}</h2>
                <div className={styles.group}>
                    <button className={controls.iconBtn} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo}><CosmosIcon name="undo" size={15}/></button>
                    <button className={controls.iconBtn} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)" onClick={redo}><CosmosIcon name="redo" size={15}/></button>
                    <button className={controls.iconBtn} aria-label="Tidy up" title="Arrange the blocks" onClick={() => arrange(apiId)}><CosmosIcon name="schema" size={15}/></button>
                    <button
                        className={controls.iconBtn} aria-label="Fit" title="Show everything"
                        onClick={() => board.current && fitGraph(api.graph, board.current.clientWidth, board.current.clientHeight)}
                    >
                        <CosmosIcon name="fit" size={15}/>
                    </button>
                    <button className={controls.iconBtn} aria-label="Remove all" title="Remove all blocks" disabled={api.graph.nodes.length === 0} onClick={() => void clearGraph(apiId)}>
                        <CosmosIcon name="trash" size={15}/>
                    </button>
                </div>

                <select className={styles.select} value={api.language} aria-label="Language" onChange={(event) => changeLanguage(event.target.value)}>
                    {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button className={cx(controls.btn, panel === "packages" && controls.selected)} onClick={() => toggle("packages")}>
                    Packages{api.packages.length > 0 ? ` (${api.packages.length})` : ""}
                </button>
                <button className={cx(controls.btn, panel === "security" && controls.selected)} onClick={() => toggle("security")}>
                    <CosmosIcon name="shield" size={14}/> Security
                </button>
                <span className={styles.grow}/>
                <button className={controls.btn} onClick={() => void importScript()}><CosmosIcon name="import" size={14}/> Import script</button>
                <button className={controls.btn} onClick={() => void exportScript()}><CosmosIcon name="save" size={14}/> Save script</button>
                <button className={cx(controls.btn, testing && controls.selected)} onClick={() => setTesting(!testing)} title="Try this API on a safe copy of your data">
                    <CosmosIcon name="play" size={14}/> Test
                </button>
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => setExporting(true)}><CosmosIcon name="export" size={14}/> Export code</button>
            </header>

            {panel !== "" && (
                <div className={styles.drawer}>
                    {panel === "packages" && (
                        <>
                            <div className={styles.cols}>
                                <SelectField
                                    label="Database" value={api.databaseId}
                                    options={[{value: "", label: "None"}, ...(project?.databases.map((item) => ({value: item.id, label: item.name})) ?? [])]}
                                    onChange={(databaseId) => patch({databaseId})}
                                />
                                <NumberField label="Port" value={api.port} min={1024} max={65535} onChange={(port) => patch({port}, "port")}/>
                                <TextField label="Base path" value={api.basePath} mono onChange={(basePath) => patch({basePath}, "basePath")}/>
                            </div>
                            <div className={styles.packages}>
                                {language?.packages.length === 0 && <span className={styles.muted}>This language has no optional packages.</span>}
                                {language?.packages.map((item) => (
                                    <label key={item.id} className={styles.package} title={item.description}>
                                        <input
                                            type="checkbox" checked={api.packages.includes(item.id)}
                                            onChange={(event) => patch({packages: event.target.checked ? [...api.packages, item.id] : api.packages.filter((id) => id !== item.id)})}
                                        />
                                        <span><b>{item.name}</b><small>{item.description}</small></span>
                                    </label>
                                ))}
                            </div>
                        </>
                    )}
                    {panel === "security" && (
                        <div className={styles.cols}>
                            <ToggleField label="Require an API key" value={api.security.requireApiKey} onChange={(requireApiKey) => patchSecurity({requireApiKey})} hint="Turn off only for public data."/>
                            <NumberField label="Requests per minute" value={api.security.rateLimitPerMinute} min={0} max={100000} onChange={(rateLimitPerMinute) => patchSecurity({rateLimitPerMinute}, "rate")}/>
                            <NumberField label="Largest request (KB)" value={api.security.maxBodyKb} min={1} max={10240} onChange={(maxBodyKb) => patchSecurity({maxBodyKb}, "body")}/>
                            <TextField
                                label="Websites that may call it" value={api.security.allowedOrigins.join(", ")} mono placeholder="https://myapp.com"
                                hint="Separate with commas. Empty means no website."
                                onChange={(text) => patchSecurity({allowedOrigins: text.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20)}, "origins")}
                            />
                        </div>
                    )}
                </div>
            )}

            {project && project.databases.length > 0 && (
                <div className={styles.detect}>
                    {database ? (
                        <>
                            <CosmosIcon name="database" size={14}/>
                            <span>Using <b>{database.name}</b>{database.tables.length > 0 ? `: ${database.tables.slice(0, 6).map((table) => table.name).join(", ")}${database.tables.length > 6 ? ` and ${database.tables.length - 6} more` : ""}` : ", which has no tables yet."}</span>
                            <span className={styles.grow}/>
                            {database.tables.length > 0 && (
                                <button
                                    className={controls.btn}
                                    onClick={(event) => showMenuAtEvent(event, database.tables.slice(0, 30).map((table) => ({label: table.name, hint: "list, read, create, change, delete", onSelect: () => addTableRoutes(apiId, table.name)})))}
                                >
                                    <CosmosIcon name="plus" size={13}/> Add routes for a table
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            <CosmosIcon name="database" size={14}/>
                            <span>This API has no database yet. Found in this project:</span>
                            {project.databases.slice(0, 4).map((item) => (
                                <button key={item.id} className={controls.btn} onClick={() => patch({databaseId: item.id})}>
                                    Use {item.name} ({item.tables.length} {item.tables.length === 1 ? "table" : "tables"})
                                </button>
                            ))}
                        </>
                    )}
                </div>
            )}

            <div className={styles.work} ref={board}>
                <CosmosFlowPalette apiId={apiId} language={language} database={database} boardSize={() => ({width: board.current?.clientWidth ?? 800, height: board.current?.clientHeight ?? 600})}/>
                <CosmosFlowCanvas api={api} database={database}/>
                <CosmosFlowInspector apiId={apiId} node={node} selectedCount={selected.length} database={database} language={language}/>
            </div>

            {testing && <CosmosApiTester api={api} database={database} onClose={() => setTesting(false)}/>}
            {languages.length === 0 && <EmptyState icon="code" title="No language is installed" text="Install an extension that adds a language."/>}
            <CosmosApiExportDialog open={exporting} api={api} database={database} onClose={() => setExporting(false)}/>
        </div>
    );
}
