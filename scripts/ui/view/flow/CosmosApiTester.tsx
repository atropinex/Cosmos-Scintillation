import {useMemo, useRef, useState} from "react";
import type {ApiTestResult, CosmosApi, CosmosDatabase, SocketTestResult, TestStep} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {useDocument} from "../../controller/document/CosmosDocument.Controller";
import {hintsForEvent, hintsForRoute} from "../../controller/json/CosmosJsonHint.Controller";
import {select as selectNodes} from "../../controller/flow/CosmosFlow.Controller";
import {showToast} from "../../controller/toast/CosmosToast.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosJsonEditor from "../shared/CosmosJsonEditor";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosApiTester.module.css";

interface CosmosApiTesterProps {
    api: CosmosApi;
    database: CosmosDatabase | undefined;
    onClose: () => void;
}

type Mode = "rest" | "socket";

const pretty = (value: unknown): string => {
    if (value === null || value === undefined) {
        return "(empty)";
    }
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

/** "Name: value" per line -> an object. Lines without a colon are ignored. */
function readHeaders(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const at = line.indexOf(":");
        if (at > 0) {
            result[line.slice(0, at).trim()] = line.slice(at + 1).trim();
        }
    }
    return result;
}

/** Empty text is "no body". Anything else must be JSON; null means it is not. */
function readJson(text: string): {ok: true; value: unknown} | {ok: false} {
    if (text.trim() === "") {
        return {ok: true, value: null};
    }
    try {
        return {ok: true, value: JSON.parse(text)};
    } catch {
        return {ok: false};
    }
}

/** Tries the API on a safe copy of the project's data: pick a route or an event, fill it in, press Send. */
export default function CosmosApiTester({api, database, onClose}: CosmosApiTesterProps) {
    const {path: projectPath} = useDocument();
    const grip = useRef<{y: number; height: number} | null>(null);

    const routes = useMemo(() => api.graph.nodes.filter((node) => node.kind === "route").map((node) => ({
        id: node.id,
        method: String(node.props.method ?? "GET"),
        path: `${api.basePath.replace(/\/$/, "")}/${String(node.props.path ?? "/").replace(/^\//, "")}`
    })), [api]);
    const events = useMemo(() => api.graph.nodes.filter((node) => node.kind === "wsEvent").map((node) => ({id: node.id, event: String(node.props.event ?? "message")})), [api]);

    const [mode, setMode] = useState<Mode>(routes.length === 0 && events.length > 0 ? "socket" : "rest");
    const [routeId, setRouteId] = useState("");
    const [params, setParams] = useState<Record<string, string>>({});
    const [query, setQuery] = useState("");
    const [headers, setHeaders] = useState("");
    const [body, setBody] = useState("");
    const [sendKey, setSendKey] = useState(true);
    const [eventName, setEventName] = useState("");
    const [data, setData] = useState("");
    const [busy, setBusy] = useState(false);
    const [height, setHeight] = useState(300);
    const [rest, setRest] = useState<ApiTestResult | null>(null);
    const [socket, setSocket] = useState<SocketTestResult | null>(null);

    const route = routes.find((item) => item.id === routeId) ?? routes[0];
    const event = events.find((item) => item.event === eventName) ?? events[0];
    const paramNames = (route?.path.match(/:[A-Za-z0-9_]+/g) ?? []).map((name) => name.slice(1));
    const hasBody = route !== undefined && ["POST", "PUT", "PATCH"].includes(route.method);

    const send = async () => {
        if (!projectPath || busy) {
            return;
        }
        setBusy(true);
        try {
            if (mode === "rest" && route) {
                const json = readJson(body);
                if (!json.ok) {
                    showToast("The body is not valid JSON.", true);
                    return;
                }
                const path = route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => encodeURIComponent(params[name] ?? ""));
                setRest(await window.api.testApi(projectPath, api, database ?? null, {method: route.method, path, query, headers: readHeaders(headers), body: hasBody ? json.value : null, sendKey}));
            } else if (event) {
                const json = readJson(data);
                if (!json.ok) {
                    showToast("The data is not valid JSON.", true);
                    return;
                }
                setSocket(await window.api.testSocket(projectPath, api, database ?? null, {event: event.event, data: json.value}));
            }
        } finally {
            setBusy(false);
        }
    };

    const reset = async () => {
        if (projectPath) {
            await window.api.resetTestData(projectPath);
            showToast("The safe copy of the data was reset");
        }
    };

    const result = mode === "rest" ? rest : socket;

    return (
        <section className={styles.panel} aria-label="API tester" style={{height}}>
            <div
                className={styles.grip} role="separator" aria-orientation="horizontal" title="Drag to make the tester taller or shorter"
                onPointerDown={(event: {clientY: number; currentTarget: HTMLElement; pointerId: number}) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    grip.current = {y: event.clientY, height};
                }}
                onPointerMove={(event: {clientY: number}) => {
                    if (grip.current) {
                        setHeight(Math.min(Math.round(window.innerHeight * 0.85), Math.max(160, grip.current.height + grip.current.y - event.clientY)));
                    }
                }}
                onPointerUp={() => {
                    grip.current = null;
                }}
            />
            <header className={styles.head}>
                <b>Test</b>
                {routes.length > 0 && events.length > 0 && (
                    <div className={controls.segmented} role="tablist">
                        <button role="tab" aria-selected={mode === "rest"} className={cx(controls.segment, mode === "rest" && controls.selected)} onClick={() => setMode("rest")}>REST</button>
                        <button role="tab" aria-selected={mode === "socket"} className={cx(controls.segment, mode === "socket" && controls.selected)} onClick={() => setMode("socket")}>WebSocket</button>
                    </div>
                )}
                <span className={styles.note}>Runs on a safe copy of your data. Nothing is saved.</span>
                <span className={styles.grow}/>
                <button className={controls.btn} onClick={() => void reset()} title="Start again from the data in your tables">Reset data</button>
                <button className={controls.iconBtn} aria-label="Close the tester" onClick={onClose}><CosmosIcon name="close" size={14}/></button>
            </header>

            <div className={styles.body}>
                <div className={styles.form}>
                    {mode === "rest" ? (
                        routes.length === 0 ? <p className={styles.empty}>This API has no Route block yet. Add one to test it.</p> : (
                            <>
                                <select className={controls.field} value={route?.id} aria-label="Route" onChange={(e) => { setRouteId(e.target.value); setRest(null); }}>
                                    {routes.map((item) => <option key={item.id} value={item.id}>{item.method} {item.path}</option>)}
                                </select>
                                {paramNames.map((name) => (
                                    <label key={name} className={styles.row}><span>{name}</span>
                                        <input className={cx(controls.field, controls.mono)} value={params[name] ?? ""} placeholder={`value of :${name}`} onChange={(e) => setParams({...params, [name]: e.target.value})}/>
                                    </label>
                                ))}
                                <label className={styles.row}><span>Query</span>
                                    <input className={cx(controls.field, controls.mono)} value={query} placeholder="page=2&sort=name" onChange={(e) => setQuery(e.target.value)}/>
                                </label>
                                {hasBody && (
                                    <CosmosJsonEditor value={body} onChange={setBody} hints={hintsForRoute(api, database, route.id)} placeholder={'Body as JSON, for example {"title": "Milk"}'} ariaLabel="Body"/>
                                )}
                                <textarea className={cx(controls.field, controls.mono, styles.small)} value={headers} placeholder={"Headers, one per line\nUser-Agent: test"} spellCheck={false} onChange={(e) => setHeaders(e.target.value)}/>
                                <label className={styles.check}>
                                    <input type="checkbox" checked={sendKey} onChange={(e) => setSendKey(e.target.checked)}/>
                                    Send the API key {api.security.requireApiKey ? "" : "(this API does not need one)"}
                                </label>
                            </>
                        )
                    ) : (
                        events.length === 0 ? <p className={styles.empty}>This API has no WebSocket event block yet. Add one to test it.</p> : (
                            <>
                                <select className={controls.field} value={event?.event} aria-label="Event" onChange={(e) => { setEventName(e.target.value); setSocket(null); }}>
                                    {events.map((item) => <option key={item.id} value={item.event}>{item.event}</option>)}
                                </select>
                                <CosmosJsonEditor value={data} onChange={setData} hints={hintsForEvent(api)} placeholder={'Message data as JSON, for example {"text": "hello"}'} ariaLabel="Message data"/>
                            </>
                        )
                    )}
                    <button className={cx(controls.btn, controls.btnPrimary)} disabled={busy || !projectPath || (mode === "rest" ? !route : !event)} onClick={() => void send()}>
                        <CosmosIcon name="play" size={13}/> Send
                    </button>
                </div>

                <div className={styles.result}>
                    {!result && <p className={styles.empty}>The answer appears here.</p>}
                    {result && (
                        <>
                            <div className={styles.summary}>
                                {mode === "rest" && rest && <span className={cx(styles.status, rest.status >= 400 || rest.status === 0 ? styles.bad : styles.good)}>{rest.status || "Error"}</span>}
                                {mode === "socket" && socket && <span className={cx(styles.status, socket.ok ? styles.good : styles.bad)}>{socket.ok ? "Done" : "Error"}</span>}
                                {mode === "rest" && rest?.route && <code>{rest.route}</code>}
                                <span className={styles.note}>{result.ms} ms{result.changes > 0 ? ` · ${result.changes} row${result.changes === 1 ? "" : "s"} changed in the copy` : ""}</span>
                            </div>
                            {result.error && mode === "socket" && <p className={styles.problem}>{result.error}</p>}
                            {mode === "rest" && rest && <pre className={styles.code}>{pretty(rest.body)}</pre>}
                            {mode === "socket" && socket && (socket.replies.length === 0
                                ? <p className={styles.empty}>No message was sent back.</p>
                                : socket.replies.map((reply, index) => (
                                    <div key={index} className={styles.reply}>
                                        <span className={styles.tag}>{reply.to === "sender" ? "to the sender" : reply.to === "all" ? "to everyone" : "to everyone else"}</span>
                                        <b>{reply.event}</b>
                                        <pre className={styles.code}>{pretty(reply.data)}</pre>
                                    </div>
                                )))}
                            <Steps steps={result.steps}/>
                            {result.logs.length > 0 && <pre className={styles.code}>{result.logs.join("\n")}</pre>}
                            {result.notes.map((line) => <p key={line} className={styles.problem}>{line}</p>)}
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}

/** The blocks that ran, in order. Pressing one selects it on the board. */
function Steps({steps}: {steps: TestStep[]}) {
    if (steps.length === 0) {
        return null;
    }
    return (
        <ol className={styles.steps}>
            {steps.map((step, index) => (
                <li key={index}>
                    <button className={styles.step} onClick={() => selectNodes([step.nodeId])} title="Show this block on the board">
                        <b>{step.label}</b><span>{step.note}</span>
                    </button>
                </li>
            ))}
        </ol>
    );
}
