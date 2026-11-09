import {useEffect, useState} from "react";
import type {HttpMethod} from "../../../common/projects/CosmosContract";
import type {CosmosLink, LinkEndpoint, LinkHeader} from "../../../common/CommonInterface";
import {HTTP_METHODS} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {makeId} from "../../../common/utils/IdHelper";
import {updateLink, useLink} from "../../controller/document/CosmosDocument.Controller";
import {
    clearMessages, closeSocket, openSocket, resetTest, sendSocketText, sendTestRequest, stopTest, useLinkTest
} from "../../controller/link/CosmosLinkTest.Controller";
import {showToast} from "../../controller/toast/CosmosToast.Controller";
import CosmosJsonEditor from "../shared/CosmosJsonEditor";
import controls from "../shared/CosmosControls.module.css";
import {SelectField, TextField} from "../shared/CosmosFields";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosLinkEditor.module.css";

interface CosmosLinkEditorProps {
    linkId: string;
}

/**
 * A connection to a server or game that already exists (or that you build elsewhere): its address, how to sign in, the
 * calls it offers, and a place to try them. Secrets are encrypted by the app and are never shown again.
 */
export default function CosmosLinkEditor({linkId}: CosmosLinkEditorProps) {
    const link = useLink(linkId);
    const test = useLinkTest();
    const [secret, setSecret] = useState("");
    const [method, setMethod] = useState<HttpMethod>("GET");
    const [path, setPath] = useState("/");
    const [body, setBody] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        resetTest(linkId);
        return stopTest;
    }, [linkId]);

    if (!link) {
        return null;
    }

    const patch = (change: Partial<CosmosLink>, key = "") => updateLink(linkId, (current) => ({...current, ...change}), key);
    const isSocket = link.kind === "websocket";
    const patchEndpoint = (id: string, change: Partial<LinkEndpoint>) => patch({endpoints: link.endpoints.map((item) => item.id === id ? {...item, ...change} : item)}, `endpoint-${id}`);
    const patchHeader = (index: number, change: Partial<LinkHeader>) => patch({headers: link.headers.map((item, at) => at === index ? {...item, ...change} : item)}, `header-${index}`);

    const saveSecret = async () => {
        if (!secret) {
            return;
        }
        try {
            patch({auth: {...link.auth, secret: await window.api.encryptSecret(secret)}});
            setSecret("");
            showToast("Secret saved (encrypted)");
        } catch (error) {
            showToast((error as Error).message, true);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.main}>
                <h2 className={styles.title}>{link.name}</h2>
                <TextField label="Address" value={link.url} mono placeholder={isSocket ? "wss://game.example.com/socket" : "https://api.example.com"} onChange={(url) => patch({url}, "url")}/>
                <TextField label="Notes" value={link.description} onChange={(description) => patch({description}, "description")}/>
                <SelectField
                    label="Sign in with" value={link.auth.type}
                    options={[{value: "none", label: "Nothing"}, {value: "bearer", label: "Bearer token"}, {value: "apiKey", label: "API key header"}, {value: "basic", label: "Username:password"}]}
                    onChange={(type) => patch({auth: {...link.auth, type: type as CosmosLink["auth"]["type"]}})}
                />
                {link.auth.type === "apiKey" && <TextField label="Header name" value={link.auth.name} mono onChange={(name) => patch({auth: {...link.auth, name}}, "auth-name")}/>}
                {link.auth.type !== "none" && (
                    <div className={styles.secret}>
                        <input
                            className={cx(controls.field, controls.mono)} type="password" autoComplete="off" value={secret}
                            placeholder={link.auth.secret ? "A secret is saved. Type to replace it." : "Paste the secret"}
                            onChange={(event) => setSecret(event.target.value)}
                        />
                        <button className={controls.btn} disabled={!secret} onClick={() => void saveSecret()}>Save secret</button>
                        {link.auth.secret && <button className={controls.btn} onClick={() => patch({auth: {...link.auth, secret: ""}})}>Forget</button>}
                    </div>
                )}

                <h3 className={styles.heading}>Headers</h3>
                {link.headers.map((header, index) => (
                    <div key={index} className={styles.header}>
                        <input type="checkbox" checked={header.enabled} onChange={(event) => patchHeader(index, {enabled: event.target.checked})} aria-label="Use"/>
                        <input className={controls.field} placeholder="Name" value={header.key} onChange={(event) => patchHeader(index, {key: event.target.value})}/>
                        <input className={controls.field} placeholder="Value" value={header.value} onChange={(event) => patchHeader(index, {value: event.target.value})}/>
                        <button className={controls.iconBtn} aria-label="Remove header" onClick={() => patch({headers: link.headers.filter((_, at) => at !== index)})}><CosmosIcon name="close" size={13}/></button>
                    </div>
                ))}
                <button className={controls.btn} onClick={() => patch({headers: [...link.headers, {key: "", value: "", enabled: true}]})}><CosmosIcon name="plus" size={13}/> Add header</button>

                <h3 className={styles.heading}>{isSocket ? "Messages" : "Calls"}</h3>
                {link.endpoints.map((endpoint) => (
                    <div key={endpoint.id} className={styles.endpoint}>
                        <span className={controls.tag}>{endpoint.method}</span>
                        <input className={cx(controls.field, controls.mono)} value={endpoint.path} onChange={(event) => patchEndpoint(endpoint.id, {path: event.target.value})}/>
                        <button
                            className={controls.btn}
                            onClick={() => {
                                if (isSocket) {
                                    setMessage(endpoint.body);
                                } else {
                                    setMethod(endpoint.method as HttpMethod);
                                    setPath(endpoint.path);
                                    setBody(endpoint.body);
                                }
                            }}
                        >
                            Try
                        </button>
                        <button className={controls.iconBtn} aria-label="Remove" onClick={() => patch({endpoints: link.endpoints.filter((item) => item.id !== endpoint.id)})}><CosmosIcon name="close" size={13}/></button>
                    </div>
                ))}
                <button
                    className={controls.btn}
                    onClick={() => patch({endpoints: [...link.endpoints, {id: makeId("endpoint"), name: "call", method: isSocket ? "SEND" : "GET", path: "/", description: "", body: ""}]})}
                >
                    <CosmosIcon name="plus" size={13}/> Add {isSocket ? "message" : "call"}
                </button>
            </div>

            <aside className={styles.test}>
                <h3 className={styles.heading}>Try it</h3>
                {isSocket ? (
                    <>
                        <div className={styles.row}>
                            {test.socketOpen ? (
                                <button className={controls.btn} onClick={() => void closeSocket(linkId)}><CosmosIcon name="stop" size={13}/> Disconnect</button>
                            ) : (
                                <button className={cx(controls.btn, controls.btnPrimary)} onClick={() => void openSocket(link)}><CosmosIcon name="plug" size={13}/> Connect</button>
                            )}
                            <button className={controls.btn} onClick={clearMessages}>Clear</button>
                        </div>
                        <div className={styles.console}>
                            {test.messages.map((item, index) => <div key={index} className={cx(styles.line, styles[item.type])}>{item.text || item.type}</div>)}
                            {test.messages.length === 0 && <span className={styles.muted}>Nothing yet.</span>}
                        </div>
                        <div className={styles.row}>
                            <input className={cx(controls.field, controls.mono)} value={message} placeholder='{"event": "hello"}' onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && test.socketOpen && void sendSocketText(linkId, message)}/>
                            <button className={controls.btn} disabled={!test.socketOpen || !message} onClick={() => void sendSocketText(linkId, message)}><CosmosIcon name="send" size={13}/></button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className={styles.row}>
                            <select className={controls.field} style={{width: 100}} value={method} onChange={(event) => setMethod(event.target.value as HttpMethod)}>
                                {HTTP_METHODS.map((item) => <option key={item}>{item}</option>)}
                            </select>
                            <input className={cx(controls.field, controls.mono)} value={path} onChange={(event) => setPath(event.target.value)}/>
                            <button className={cx(controls.btn, controls.btnPrimary)} disabled={test.sending} onClick={() => void sendTestRequest(link, method, path, body)}>Send</button>
                        </div>
                        {method !== "GET" && <CosmosJsonEditor value={body} onChange={setBody} placeholder="JSON body" ariaLabel="JSON body"/>}
                        {test.response && (
                            <div className={styles.response}>
                                <div className={styles.status}>
                                    {test.response.error ? <span className={styles.bad}>{test.response.error}</span> : (
                                        <span className={test.response.ok ? styles.good : styles.bad}>{test.response.status} {test.response.statusText} · {test.response.millis} ms</span>
                                    )}
                                </div>
                                <pre className={styles.code}>{test.response.body}{test.response.truncated ? "\n... (cut)" : ""}</pre>
                            </div>
                        )}
                    </>
                )}
            </aside>
        </div>
    );
}
