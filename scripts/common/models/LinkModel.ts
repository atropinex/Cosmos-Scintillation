import {parse} from "yaml";
import type {CosmosLink, LinkEndpoint, LinkMethod, LinkTestResponse} from "../CommonInterface";
import {MAX_ENDPOINTS_PER_LINK, MAX_FILE_BYTES, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS} from "../projects/CosmosConfig";
import {HTTP_METHODS, type HttpMethod} from "../projects/CosmosContract";
import {isOneOf, isRecord, toText} from "../utils/GuardHelper";
import {makeId} from "../utils/IdHelper";
import {createLink} from "../utils/ProjectFactory";
import type {SecretModel} from "./SecretModel";

const HEADER_NAME = /^[A-Za-z0-9-]{1,60}$/;
/** Headers the user may not set: the runtime owns them, and some would allow request smuggling. */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "expect"]);
const MAX_REQUEST_BODY = 1024 * 1024;
const MAX_HEADERS = 40;

export type ImportOutcome = {link: CosmosLink} | {error: string};

const text = (value: unknown, max: number): string => toText(value, "", max).trim();

function httpUrl(value: string, protocols: string[]): string {
    try {
        const url = new URL(value);
        return protocols.includes(url.protocol) ? url.origin + url.pathname.replace(/\/+$/, "") : "";
    } catch {
        return "";
    }
}

/** The headers a link sends: its own enabled ones plus the authentication one. Secrets are decrypted here only. */
export function linkHeaders(link: CosmosLink, secrets: Pick<SecretModel, "decrypt">): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const header of link.headers.slice(0, MAX_HEADERS)) {
        const name = String(header.key ?? "").trim();
        if (header.enabled === true && HEADER_NAME.test(name) && !FORBIDDEN_HEADERS.has(name.toLowerCase())) {
            headers[name] = String(header.value ?? "").replace(/[\r\n\0]/g, "").slice(0, 2000);
        }
    }

    const secret = secrets.decrypt(link.auth.secret).replace(/[\r\n\0]/g, "");
    if (secret !== "") {
        if (link.auth.type === "bearer") {
            headers.Authorization = `Bearer ${secret}`;
        } else if (link.auth.type === "basic") {
            headers.Authorization = `Basic ${Buffer.from(secret, "utf8").toString("base64")}`;
        } else if (link.auth.type === "apiKey" && HEADER_NAME.test(link.auth.name) && !FORBIDDEN_HEADERS.has(link.auth.name.toLowerCase())) {
            headers[link.auth.name] = secret;
        }
    }
    return headers;
}

/** Checks a link that came from the page (the project sanitizer does the full check when it is saved). */
export function toLink(raw: unknown): CosmosLink | null {
    if (!isRecord(raw) || typeof raw.url !== "string" || !isRecord(raw.auth)) {
        return null;
    }
    const auth = raw.auth;
    return {
        id: text(raw.id, 64), name: text(raw.name, 80), kind: raw.kind === "websocket" ? "websocket" : "rest",
        source: "manual", url: text(raw.url, 500), description: "", endpoints: [],
        auth: {
            type: isOneOf(["none", "bearer", "apiKey", "basic"] as const, auth.type) ? auth.type : "none",
            name: text(auth.name, 60), secret: text(auth.secret, 4000)
        },
        headers: (Array.isArray(raw.headers) ? raw.headers.slice(0, MAX_HEADERS) : []).filter(isRecord).map((item) => ({
            key: text(item.key, 60), value: toText(item.value, "", 2000), enabled: item.enabled === true
        }))
    };
}

/** Imports API descriptions and sends test requests. Only http and https are ever contacted. */
export class LinkModel {
    constructor(private readonly secrets: Pick<SecretModel, "decrypt" | "encrypt">) {
    }

    encryptSecret(plain: unknown): string {
        return typeof plain === "string" ? this.secrets.encrypt(plain) : "";
    }

    // === Importing OpenAPI 3, Swagger 2 and AsyncAPI files === //

    importText(source: string, fileName: string): ImportOutcome {
        if (source.length > MAX_FILE_BYTES) {
            return {error: "The file is too big."};
        }
        let raw: unknown;
        try {
            raw = parse(source); // YAML also reads JSON
        } catch (error) {
            return {error: `The file is not valid JSON or YAML: ${(error as Error).message.split("\n")[0]}`};
        }
        if (!isRecord(raw)) {
            return {error: "Expected an OpenAPI, Swagger or AsyncAPI description."};
        }
        const info = isRecord(raw.info) ? raw.info : {};
        const name = text(info.title, 80) || fileName.replace(/\.[^.]+$/, "").slice(0, 80) || "Imported API";
        const description = text(info.description, 400);

        let link: CosmosLink;
        if (typeof raw.asyncapi === "string") {
            link = this.fromAsync(raw, name);
        } else if (typeof raw.openapi === "string" || typeof raw.swagger === "string") {
            link = this.fromOpenApi(raw, name);
        } else {
            return {error: "This is not an OpenAPI, Swagger or AsyncAPI file."};
        }
        link.description = description;
        link.endpoints = link.endpoints.slice(0, MAX_ENDPOINTS_PER_LINK);
        return {link};
    }

    private fromOpenApi(raw: Record<string, unknown>, name: string): CosmosLink {
        let url = "";
        if (Array.isArray(raw.servers) && isRecord(raw.servers[0])) {
            url = httpUrl(String(raw.servers[0].url ?? ""), ["http:", "https:"]);
        } else if (typeof raw.host === "string") {
            const scheme = Array.isArray(raw.schemes) && raw.schemes.includes("http") && !raw.schemes.includes("https") ? "http" : "https";
            url = httpUrl(`${scheme}://${raw.host}${typeof raw.basePath === "string" ? raw.basePath : ""}`, ["http:", "https:"]);
        }

        const link = createLink(name, "rest", "openapi", url);
        const paths = isRecord(raw.paths) ? raw.paths : {};
        for (const [path, item] of Object.entries(paths)) {
            if (!isRecord(item)) {
                continue;
            }
            for (const method of HTTP_METHODS) {
                const operation = item[method.toLowerCase()];
                if (!isRecord(operation)) {
                    continue;
                }
                link.endpoints.push({
                    id: makeId("ep"),
                    name: text(operation.summary, 80) || text(operation.operationId, 80) || `${method} ${path}`.slice(0, 80),
                    method, path: text(path, 300), description: text(operation.description, 400), body: this.exampleBody(operation)
                });
                if (link.endpoints.length >= MAX_ENDPOINTS_PER_LINK) {
                    return link;
                }
            }
        }
        return link;
    }

    /** The example request body of an operation, when the file has one. */
    private exampleBody(operation: Record<string, unknown>): string {
        const content = isRecord(operation.requestBody) && isRecord(operation.requestBody.content) ? operation.requestBody.content : {};
        const json = content["application/json"];
        const example = isRecord(json) ? (json.example ?? (isRecord(json.schema) ? json.schema.example : undefined)) : undefined;
        return example === undefined ? "" : JSON.stringify(example, null, 2).slice(0, 4000);
    }

    private fromAsync(raw: Record<string, unknown>, name: string): CosmosLink {
        let url = "";
        const servers = isRecord(raw.servers) ? Object.values(raw.servers) : [];
        const server = servers.find(isRecord);
        if (server) {
            const host = String(server.url ?? server.host ?? "");
            const protocol = String(server.protocol ?? "wss");
            url = httpUrl(/^[a-z]+:\/\//i.test(host) ? host : `${protocol}://${host}${String(server.pathname ?? "")}`, ["ws:", "wss:"]);
        }

        const link = createLink(name, "websocket", "asyncapi", url);
        const add = (path: string, method: LinkMethod, description: unknown, message: unknown): void => {
            if (link.endpoints.length >= MAX_ENDPOINTS_PER_LINK) {
                return;
            }
            const example = isRecord(message) && Array.isArray(message.examples) && isRecord(message.examples[0]) ? message.examples[0].payload : undefined;
            link.endpoints.push({
                id: makeId("ep"), name: `${method === "SEND" ? "Send" : "Receive"} ${path}`.slice(0, 80), method,
                path: text(path, 300), description: text(description, 400), body: example === undefined ? "" : JSON.stringify(example, null, 2).slice(0, 4000)
            } satisfies LinkEndpoint);
        };

        const channels = isRecord(raw.channels) ? raw.channels : {};
        if (typeof raw.asyncapi === "string" && raw.asyncapi.startsWith("3") && isRecord(raw.operations)) {
            for (const operation of Object.values(raw.operations)) {
                const ref = isRecord(operation) && isRecord(operation.channel) ? String(operation.channel.$ref ?? "") : "";
                const channel = channels[ref.replace("#/channels/", "")];
                const address = isRecord(channel) ? String(channel.address ?? ref.replace("#/channels/", "")) : ref.replace("#/channels/", "");
                if (isRecord(operation) && address !== "") {
                    add(address, operation.action === "send" ? "SEND" : "RECEIVE", operation.summary ?? operation.description, undefined);
                }
            }
        } else {
            for (const [path, channel] of Object.entries(channels)) {
                if (!isRecord(channel)) {
                    continue;
                }
                // In AsyncAPI 2 "publish" means the application receives, so the client sends.
                for (const [key, method] of [["publish", "SEND"], ["subscribe", "RECEIVE"]] as const) {
                    const operation = channel[key];
                    if (isRecord(operation)) {
                        add(path, method, operation.summary ?? operation.description, operation.message);
                    }
                }
            }
        }
        return link;
    }

    // === Sending a test request === //

    async sendRequest(raw: unknown): Promise<LinkTestResponse> {
        const failed = (error: string): LinkTestResponse => ({ok: false, status: 0, statusText: "", millis: 0, headers: {}, body: "", truncated: false, error});
        if (!isRecord(raw)) {
            return failed("The request is not valid.");
        }
        const link = toLink(raw.link);
        const path = typeof raw.path === "string" ? raw.path.trim().slice(0, 2000) : "";
        const method: HttpMethod | null = isOneOf(HTTP_METHODS, raw.method) ? raw.method : null;
        const body = typeof raw.body === "string" ? raw.body : "";
        if (!link || !method || body.length > MAX_REQUEST_BODY) {
            return failed("The request is not valid.");
        }

        let target: URL;
        try {
            const base = link.url.replace(/\/+$/, "");
            target = /^https?:\/\//i.test(path) ? new URL(path) : new URL(base + (path.startsWith("/") || path === "" ? path : `/${path}`));
        } catch {
            return failed("The address is not valid.");
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
            return failed("Only http and https addresses can be tested.");
        }

        // Secrets are only sent to the host the link points at, never to another one typed into the path.
        let sameHost = false;
        try {
            sameHost = new URL(link.url).origin === target.origin;
        } catch {
            sameHost = false;
        }
        const headers = sameHost ? linkHeaders(link, this.secrets) : {};
        if (body !== "" && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
            headers["Content-Type"] = "application/json";
        }

        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(target, {
                method, headers, redirect: "manual", signal: controller.signal,
                body: method === "GET" || body === "" ? undefined : body
            });
            const {content, truncated} = await readLimited(response);
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value.slice(0, 1000);
            });
            return {
                ok: response.status >= 200 && response.status < 400, status: response.status, statusText: response.statusText,
                millis: Date.now() - started, headers: responseHeaders, body: content, truncated, error: ""
            };
        } catch (error) {
            const aborted = (error as Error).name === "AbortError";
            return {...failed(aborted ? `No answer after ${REQUEST_TIMEOUT_MS / 1000} seconds.` : `Request failed: ${(error as Error).message}`.slice(0, 300)), millis: Date.now() - started};
        } finally {
            clearTimeout(timer);
        }
    }
}

/** Reads at most MAX_RESPONSE_BYTES of the body, then stops the download. */
async function readLimited(response: Response): Promise<{content: string; truncated: boolean}> {
    if (!response.body) {
        return {content: "", truncated: false};
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) {
            chunks.push(value.subarray(0, value.length - (size - MAX_RESPONSE_BYTES)));
            truncated = true;
            await reader.cancel();
            break;
        }
        chunks.push(value);
    }
    return {content: Buffer.concat(chunks).toString("utf8"), truncated};
}
