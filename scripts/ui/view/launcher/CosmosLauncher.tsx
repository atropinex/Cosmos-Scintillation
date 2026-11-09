import {useEffect, useState} from "react";
import type {ServiceDefinition, ServiceState} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {
    changeService, fetchLogs, findProgram, pickFolder, startAll, startService, startWatching, stopAll, stopService, stopWatching,
    useProjectFolder, useServices
} from "../../controller/launcher/CosmosLauncher.Controller";
import {useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import controls from "../shared/CosmosControls.module.css";
import {EmptyState} from "../shared/CosmosEmpty";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosLauncher.module.css";

const STATUS_TEXT: Record<ServiceState["status"], string> = {stopped: "Stopped", starting: "Starting...", running: "Running", error: "Problem"};

interface RowProps {
    definition: ServiceDefinition;
    state: ServiceState;
}

/** One service: a light, its name, and the buttons to start it. The details open below. */
function ServiceRow({definition, state}: RowProps) {
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState<string[] | null>(null);
    const running = state.status === "running" || state.status === "starting";
    const isStatic = definition.kind === "builtin-static";
    const canStart = isStatic ? !!state.settings.root : !!state.resolvedPath;

    // The log is only read while it is open and the service is alive.
    useEffect(() => {
        if (logs === null) {
            return;
        }
        let current = true;
        const read = () => void fetchLogs(definition.id).then((lines) => current && setLogs(lines));
        const timer = window.setInterval(read, 1500);
        return () => {
            current = false;
            window.clearInterval(timer);
        };
    }, [logs === null, definition.id]);

    return (
        <div className={cx(styles.row, running && styles.live)}>
            <div className={styles.main}>
                <span className={cx(controls.dot, state.status === "running" && controls.dotRunning, state.status === "starting" && controls.dotStarting, state.status === "error" && controls.dotError)}/>
                <div className={styles.names}>
                    <span className={styles.name}>{definition.name}</span>
                    <span className={styles.meta}>
                        {STATUS_TEXT[state.status]}
                        {running && state.settings.port > 0 ? ` · port ${state.settings.port}` : ""}
                        {!running && !canStart ? (isStatic ? " · choose a folder to share" : " · program not found") : ""}
                    </span>
                </div>
                {state.url && state.status === "running" && (
                    <a className={styles.link} href={state.url} target="_blank" rel="noreferrer">Open</a>
                )}
                {running ? (
                    <button className={controls.btn} onClick={() => void stopService(definition.id)}><CosmosIcon name="stop" size={13}/> Stop</button>
                ) : (
                    <button className={cx(controls.btn, controls.btnPrimary)} disabled={!canStart} onClick={() => void startService(definition.id)}>
                        <CosmosIcon name="play" size={13}/> Start
                    </button>
                )}
                <button className={controls.iconBtn} aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}>
                    <CosmosIcon name={open ? "chevronDown" : "chevronRight"} size={14}/>
                </button>
            </div>

            {state.error && <div className={styles.error}>{state.error}</div>}

            {open && (
                <div className={styles.details}>
                    <p className={styles.desc}>{definition.description}</p>
                    <label className={styles.field}>
                        <span>Port</span>
                        <input
                            className={styles.input} type="number" min={1024} max={65535} value={state.settings.port || definition.defaultPort} disabled={running}
                            onChange={(event) => void changeService(definition.id, {port: Number(event.target.value)})}
                        />
                    </label>
                    {isStatic ? (
                        <div className={styles.field}>
                            <span>Shared folder</span>
                            <div className={styles.path}>
                                <code>{state.settings.root || "none chosen"}</code>
                                <button className={controls.btn} disabled={running} onClick={() => void pickFolder(definition.id)}>Choose...</button>
                                <button className={controls.btn} disabled={running} onClick={() => void useProjectFolder(definition.id)}>Use project folder</button>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.field}>
                            <span>Program</span>
                            <div className={styles.path}>
                                <code>{state.resolvedPath || "not found"}</code>
                                <button className={controls.btn} disabled={running} onClick={() => void findProgram(definition.id)}>Find...</button>
                            </div>
                            {!state.resolvedPath && definition.installHint && <small className={styles.hint}>{definition.installHint}</small>}
                        </div>
                    )}
                    <label className={styles.check}>
                        <input type="checkbox" checked={state.settings.autoStart} onChange={(event) => void changeService(definition.id, {autoStart: event.target.checked})}/>
                        Start when the app opens
                    </label>
                    <button className={controls.btn} onClick={() => setLogs(logs === null ? [] : null)}>{logs === null ? "Show log" : "Hide log"}</button>
                    {logs !== null && <pre className={styles.log}>{logs.length ? logs.join("\n") : "Nothing logged yet."}</pre>}
                </div>
            )}
        </div>
    );
}

/** The local servers of the app, like the control panel of XAMPP. Everything listens on this computer only. */
export default function CosmosLauncher() {
    const states = useServices();
    const {services} = useRegistries();

    useEffect(() => {
        void startWatching();
        return stopWatching;
    }, []);

    return (
        <div className={styles.launcher}>
            <header className={styles.bar}>
                <h1 className={styles.title}>Launcher</h1>
                <span className={styles.sub}>Servers on this computer only</span>
                <span className={styles.grow}/>
                <button className={controls.btn} onClick={() => void stopAll()}>Stop all</button>
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => void startAll()}>Start all</button>
            </header>
            <div className={styles.body}>
                {services.length === 0 ? (
                    <EmptyState icon="server" title="No services" text="Services are added by extensions or by files in the services folder."/>
                ) : (
                    services.map((definition, index) => {
                        const state = states.find((item) => item.id === definition.id);
                        return state && (
                            <div key={definition.id} style={{animationDelay: `calc(${Math.min(index, 10)} * var(--t-fast) * 0.3)`}} className={styles.enter}>
                                <ServiceRow definition={definition} state={state}/>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
