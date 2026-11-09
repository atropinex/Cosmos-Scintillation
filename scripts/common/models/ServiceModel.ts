import {spawn, type ChildProcess} from "child_process";
import {app} from "electron";
import {createReadStream, promises as fs, type Stats} from "fs";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "http";
import {connect} from "net";
import {delimiter, dirname, extname, isAbsolute, join, resolve, sep} from "path";
import {pipeline} from "stream";
import {parse} from "yaml";
import type {ServiceDefinition, ServiceSettings, ServiceState} from "../CommonInterface";
import {LOCAL_HOST, MAX_LOG_LINE_LENGTH, MAX_LOG_LINES, MAX_PORT, MIN_PORT} from "../projects/CosmosConfig";
import {SERVICE_CATEGORIES, SERVICE_KINDS} from "../projects/CosmosContract";
import {isOneOf, isRecord, toNumber, toText} from "../utils/GuardHelper";
import {DEFAULT_SERVICE_SETTINGS} from "./SettingsModel";
import type {ProblemList, RegistryFile} from "./RegistryTypes";
import type {SettingsModel} from "./SettingsModel";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
const START_TIMEOUT_MS = 30000;
const PREPARE_TIMEOUT_MS = 120000;
const STOP_GRACE_MS = 5000;

// === Reading service files === //

/** One step that runs once before the first start, for example creating an empty database folder. */
export interface PrepareStep {
    /** The program name. Empty means "the service's own program". It is looked up next to it, then on the PATH. */
    program: string;
    args: string[];
    /** A path (with placeholders). When it exists the step is skipped. */
    skipIf: string;
}

/** A service definition with the parts the page does not need to see. */
export interface ServiceSpec extends ServiceDefinition {
    args: string[];
    prepare: PrepareStep[];
}

const stringList = (value: unknown, max: number): string[] => (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, 400))
    .slice(0, max);

/** Reads the service files. A broken file is reported and skipped; the first file with an id wins. */
export function parseServices(files: RegistryFile[], problems: ProblemList): ServiceSpec[] {
    const specs: ServiceSpec[] = [];

    for (const file of files) {
        let raw: unknown;
        try {
            raw = parse(file.text);
        } catch (error) {
            problems.push(`${file.name}: ${(error as Error).message.split("\n")[0]}`);
            continue;
        }
        if (!isRecord(raw) || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
            problems.push(`${file.name}: a service needs an "id" in lower case, for example "redis".`);
            continue;
        }
        if (specs.some((item) => item.id === raw.id)) {
            continue;
        }
        if (!isOneOf(SERVICE_KINDS, raw.kind)) {
            problems.push(`${file.name}: "kind" must be "builtin-static" or "process".`);
            continue;
        }

        // Only the program names are taken as they are; no shell ever sees them.
        const detect = stringList(raw.detect, 8).filter((name) => /^[A-Za-z0-9._-]{1,60}$/.test(name));
        const prepare: PrepareStep[] = (Array.isArray(raw.prepare) ? raw.prepare.slice(0, 6) : [])
            .filter(isRecord)
            .map((item) => ({
                program: /^[A-Za-z0-9._-]{1,60}$/.test(String(item.program ?? "")) ? String(item.program) : "",
                args: stringList(item.args, 40),
                skipIf: toText(item.skipIf, "", 400)
            }));

        specs.push({
            id: raw.id,
            name: toText(raw.name, raw.id, 60),
            description: toText(raw.description, "", 400),
            category: isOneOf(SERVICE_CATEGORIES, raw.category) ? raw.category : "Other",
            kind: raw.kind,
            defaultPort: Math.round(toNumber(raw.defaultPort, 8080, MIN_PORT, MAX_PORT)),
            detect,
            installHint: toText(raw.installHint, "", 300),
            url: toText(raw.url, "", 200),
            source: file.source,
            args: stringList(raw.args, 60),
            prepare
        });
    }
    return specs;
}

/** What the page may see of a service. */
export function toDefinition(spec: ServiceSpec): ServiceDefinition {
    const {args: _args, prepare: _prepare, ...definition} = spec;
    void _args;
    void _prepare;
    return definition;
}

// === Helpers === //

async function isFile(path: string): Promise<boolean> {
    return fs.stat(path).then((stat) => stat.isFile(), () => false);
}

async function isFolder(path: string): Promise<boolean> {
    return fs.stat(path).then((stat) => stat.isDirectory(), () => false);
}

/** Looks a program name up in the given folders (default: the PATH), like a shell would, but without a shell. */
export async function findProgram(name: string, folders?: string[]): Promise<string> {
    const places = folders ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    const suffixes = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").concat([""]) : [""];
    for (const folder of places) {
        for (const suffix of suffixes) {
            const candidate = join(folder, name + suffix);
            if (await isFile(candidate)) {
                return candidate;
            }
        }
    }
    return "";
}

/** True when something already accepts connections on the port. */
function probe(port: number): Promise<boolean> {
    return new Promise((done) => {
        const socket = connect({host: LOCAL_HOST, port});
        const finish = (open: boolean) => {
            socket.destroy();
            done(open);
        };
        socket.setTimeout(400, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
    });
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// === The built-in static file server === //

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".ico": "image/x-icon", ".avif": "image/avif", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4",
    ".webm": "video/webm", ".pdf": "application/pdf", ".wasm": "application/wasm", ".map": "application/json",
    ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8"
};

/**
 * Shares one folder over HTTP on this computer only. GET and HEAD only, no folder listings, no hidden files,
 * and nothing outside the folder can be reached (not even through a link inside it).
 */
class StaticServer {
    private server: Server | null = null;

    constructor(private readonly root: string, private readonly port: number, private readonly log: (line: string) => void) {
    }

    async start(): Promise<void> {
        const root = await fs.realpath(this.root);
        const server = createServer((request, response) => {
            void this.handle(root, request, response).catch(() => this.fail(response, 500, "Server error"));
        });
        server.headersTimeout = 10000;
        server.requestTimeout = 30000;
        server.maxHeadersCount = 50;

        await new Promise<void>((done, fail) => {
            server.once("error", fail);
            server.listen(this.port, LOCAL_HOST, () => done());
        });
        server.on("error", (error) => this.log(`Server error: ${error.message}`));
        this.server = server;
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        if (!server) {
            return;
        }
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
    }

    private fail(response: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
        if (response.headersSent) {
            response.destroy();
            return;
        }
        response.writeHead(status, {"Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers});
        response.end(text);
    }

    private async handle(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return this.fail(response, 405, "Method not allowed", {Allow: "GET, HEAD"});
        }

        // Only this computer's own names are accepted, which stops DNS rebinding from a web page.
        const host = String(request.headers.host ?? "").toLowerCase();
        if (host !== `${LOCAL_HOST}:${this.port}` && host !== `localhost:${this.port}`) {
            return this.fail(response, 403, "Forbidden");
        }

        let pathname: string;
        try {
            pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${LOCAL_HOST}`).pathname);
        } catch {
            return this.fail(response, 400, "Bad request");
        }
        if (pathname.includes("\0") || pathname.includes("\\")) {
            return this.fail(response, 400, "Bad request");
        }

        const parts = pathname.split("/").filter((part) => part !== "");
        if (parts.some((part) => part === ".." || part === "." || part.startsWith("."))) {
            return this.fail(response, 404, "Not found");
        }

        let target = resolve(root, ...parts);
        if (target !== root && !target.startsWith(root + sep)) {
            return this.fail(response, 404, "Not found");
        }

        let stat: Stats | null = await fs.stat(target).catch(() => null);
        if (stat?.isDirectory()) {
            target = join(target, "index.html");
            stat = await fs.stat(target).catch(() => null);
        }
        if (!stat || !stat.isFile()) {
            return this.fail(response, 404, "Not found");
        }

        // A link inside the folder must not lead out of it.
        const real = await fs.realpath(target).catch(() => "");
        if (real !== root && !real.startsWith(root + sep)) {
            return this.fail(response, 404, "Not found");
        }

        response.writeHead(200, {
            "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": String(stat.size),
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
        });
        if (request.method === "HEAD") {
            response.end();
            return;
        }
        pipeline(createReadStream(real), response, () => undefined);
    }
}

// === The service manager === //

interface Runtime {
    status: ServiceState["status"];
    pid: number;
    error: string;
    logs: string[];
    child: ChildProcess | null;
    server: StaticServer | null;
    /** Set while a stop is in progress, so an exit is not reported as a crash. */
    stopping: boolean;
    /** Resolves when the process has exited. */
    exited: Promise<void> | null;
}

/**
 * Starts, watches and stops the local services. Programs are started with an argument list only (never a shell),
 * always bound to 127.0.0.1, with their data inside the app's own folder.
 */
export class ServiceModel {
    private readonly runtimes = new Map<string, Runtime>();

    constructor(
        private readonly settings: Pick<SettingsModel, "read" | "update">,
        private readonly specs: () => Promise<ServiceSpec[]>,
        private readonly onChange: (states: ServiceState[]) => void
    ) {
    }

    // === Reading === //

    async list(): Promise<ServiceState[]> {
        const saved = (await this.settings.read()).services;
        const states: ServiceState[] = [];
        for (const spec of await this.specs()) {
            const runtime = this.runtimes.get(spec.id);
            const settings: ServiceSettings = {...DEFAULT_SERVICE_SETTINGS, ...saved[spec.id]};
            settings.port = settings.port || spec.defaultPort;
            const running = runtime?.status === "running" || runtime?.status === "starting";

            states.push({
                id: spec.id,
                status: runtime?.status ?? "stopped",
                settings,
                resolvedPath: spec.kind === "process" ? await this.resolveBinary(spec, settings) : "",
                pid: running ? runtime?.pid ?? 0 : 0,
                url: spec.url ? spec.url.replace(/\{host\}/g, LOCAL_HOST).replace(/\{port\}/g, String(settings.port)) : "",
                error: runtime?.error ?? "",
                needsConfirm: spec.source !== "built-in"
            });
        }
        return states;
    }

    logs(id: string): string[] {
        return [...(this.runtimes.get(id)?.logs ?? [])];
    }

    // === Settings === //

    /** The page may change the port and the autostart flag only. The program and folder come from native dialogs. */
    async patch(id: string, changes: unknown): Promise<ServiceState[]> {
        if (!isRecord(changes) || !(await this.find(id))) {
            return this.list();
        }
        const port = typeof changes.port === "number" ? Math.round(changes.port) : null;
        const autoStart = typeof changes.autoStart === "boolean" ? changes.autoStart : null;

        await this.change(id, (settings) => ({
            ...settings,
            port: port !== null && port >= MIN_PORT && port <= MAX_PORT ? port : settings.port,
            autoStart: autoStart ?? settings.autoStart
        }));
        return this.publish();
    }

    /** Called after the user picked a program or folder in a native dialog. */
    async setPath(id: string, kind: "path" | "root", value: string): Promise<ServiceState[]> {
        if (!(await this.find(id)) || !isAbsolute(value)) {
            return this.list();
        }
        const ok = kind === "path" ? await isFile(value) : await isFolder(value);
        if (ok) {
            await this.change(id, (settings) => ({...settings, [kind]: value.slice(0, 1000)}));
        }
        return this.publish();
    }

    // === Starting and stopping === //

    async autoStart(): Promise<void> {
        const saved = (await this.settings.read()).services;
        for (const spec of await this.specs()) {
            // A service from an extension never starts by itself: starting it needs the user's confirmation.
            if (saved[spec.id]?.autoStart && spec.source === "built-in") {
                await this.start(spec.id, true);
            }
        }
    }

    async start(id: string, confirmed: boolean): Promise<ServiceState[]> {
        const spec = await this.find(id);
        const current = this.runtimes.get(id);
        if (!spec || current?.status === "starting" || current?.status === "running") {
            return this.list();
        }
        if (spec.source !== "built-in" && !confirmed) {
            return this.list();
        }

        const runtime: Runtime = {status: "starting", pid: 0, error: "", logs: current?.logs ?? [], child: null, server: null, stopping: false, exited: null};
        this.runtimes.set(id, runtime);
        await this.publish();

        try {
            const saved = {...DEFAULT_SERVICE_SETTINGS, ...(await this.settings.read()).services[id]};
            const settings = {...saved, port: saved.port || spec.defaultPort};
            if (await probe(settings.port)) {
                throw new Error(`Port ${settings.port} is already in use. Pick another port.`);
            }
            if (spec.kind === "builtin-static") {
                await this.startStatic(runtime, settings);
            } else {
                await this.startProcess(spec, runtime, settings);
            }
        } catch (error) {
            runtime.status = "error";
            runtime.error = (error as Error).message.slice(0, 300);
            this.addLog(runtime, runtime.error);
            await this.killRuntime(runtime);
        }
        return this.publish();
    }

    async stop(id: string): Promise<ServiceState[]> {
        const runtime = this.runtimes.get(id);
        if (runtime) {
            await this.killRuntime(runtime);
            runtime.status = "stopped";
            runtime.error = "";
        }
        return this.publish();
    }

    async stopAll(): Promise<void> {
        await Promise.all([...this.runtimes.values()].map((runtime) => this.killRuntime(runtime)));
        for (const runtime of this.runtimes.values()) {
            runtime.status = "stopped";
        }
    }

    // === Internals === //

    private async find(id: string): Promise<ServiceSpec | undefined> {
        return typeof id === "string" ? (await this.specs()).find((spec) => spec.id === id) : undefined;
    }

    private change(id: string, change: (settings: ServiceSettings) => ServiceSettings): Promise<unknown> {
        return this.settings.update((all) => ({
            ...all,
            services: {...all.services, [id]: change({...DEFAULT_SERVICE_SETTINGS, ...all.services[id]})}
        }));
    }

    private async publish(): Promise<ServiceState[]> {
        const states = await this.list();
        this.onChange(states);
        return states;
    }

    private addLog(runtime: Runtime, text: string): void {
        for (const line of text.split(/\r?\n/)) {
            const clean = line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trimEnd();
            if (clean !== "") {
                runtime.logs.push(clean.slice(0, MAX_LOG_LINE_LENGTH));
            }
        }
        if (runtime.logs.length > MAX_LOG_LINES) {
            runtime.logs.splice(0, runtime.logs.length - MAX_LOG_LINES);
        }
    }

    private async resolveBinary(spec: ServiceSpec, settings: ServiceSettings): Promise<string> {
        if (settings.path && (await isFile(settings.path))) {
            return settings.path;
        }
        for (const name of spec.detect) {
            const found = await findProgram(name);
            if (found) {
                return found;
            }
        }
        return "";
    }

    private async startStatic(runtime: Runtime, settings: ServiceSettings): Promise<void> {
        if (!settings.root || !(await isFolder(settings.root))) {
            throw new Error("Choose the folder to share first.");
        }
        const server = new StaticServer(settings.root, settings.port, (line) => this.addLog(runtime, line));
        await server.start();
        runtime.server = server;
        runtime.status = "running";
        this.addLog(runtime, `Sharing ${settings.root} on http://${LOCAL_HOST}:${settings.port}`);
    }

    private async startProcess(spec: ServiceSpec, runtime: Runtime, settings: ServiceSettings): Promise<void> {
        const binary = await this.resolveBinary(spec, settings);
        if (!binary) {
            throw new Error(`${spec.name} was not found on this computer. ${spec.installHint}`.trim());
        }

        const data = join(app.getPath("userData"), "services", spec.id, "data");
        await fs.mkdir(data, {recursive: true});
        const fill = (text: string) => text
            .replace(/\{port\}/g, String(settings.port))
            .replace(/\{host\}/g, LOCAL_HOST)
            .replace(/\{data\}/g, data)
            .replace(/\{root\}/g, settings.root);

        for (const step of spec.prepare) {
            if (step.skipIf && (await fs.access(fill(step.skipIf)).then(() => true, () => false))) {
                continue;
            }
            const program = step.program
                ? (await findProgram(step.program, [dirname(binary)])) || (await findProgram(step.program))
                : binary;
            if (!program) {
                throw new Error(`The setup program "${step.program}" was not found next to ${binary}.`);
            }
            this.addLog(runtime, `Preparing: ${step.program || "setup"}`);
            await this.runOnce(runtime, program, step.args.map(fill), data);
        }

        const child = spawn(binary, spec.args.map(fill), {cwd: data, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
        runtime.child = child;
        runtime.pid = child.pid ?? 0;
        runtime.exited = new Promise<void>((done) => {
            child.once("exit", (code, signal) => {
                runtime.child = null;
                runtime.pid = 0;
                if (!runtime.stopping && runtime.status !== "stopped") {
                    runtime.status = code === 0 ? "stopped" : "error";
                    runtime.error = code === 0 ? "" : `Stopped unexpectedly (${signal ?? `exit code ${code}`}).`;
                    this.addLog(runtime, runtime.error || "Stopped.");
                    void this.publish();
                }
                done();
            });
        });
        child.once("error", (error) => {
            runtime.status = "error";
            runtime.error = error.message.slice(0, 300);
            this.addLog(runtime, runtime.error);
            void this.publish();
        });
        child.stdout?.on("data", (chunk: Buffer) => this.addLog(runtime, chunk.toString("utf8")));
        child.stderr?.on("data", (chunk: Buffer) => this.addLog(runtime, chunk.toString("utf8")));

        // "starting" becomes "running" once the port accepts connections.
        const deadline = Date.now() + START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (runtime.status === "error" || !runtime.child) {
                throw new Error(runtime.error || "The program stopped right after it started.");
            }
            if (await probe(settings.port)) {
                runtime.status = "running";
                return;
            }
            await wait(300);
        }
        throw new Error(`${spec.name} did not open port ${settings.port} within ${START_TIMEOUT_MS / 1000} seconds.`);
    }

    /** Runs a setup program to the end and fails when it does not finish with exit code 0. */
    private runOnce(runtime: Runtime, program: string, args: string[], cwd: string): Promise<void> {
        return new Promise((done, fail) => {
            const child = spawn(program, args, {cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
            const timer = setTimeout(() => child.kill(), PREPARE_TIMEOUT_MS);
            child.stdout?.on("data", (chunk: Buffer) => this.addLog(runtime, chunk.toString("utf8")));
            child.stderr?.on("data", (chunk: Buffer) => this.addLog(runtime, chunk.toString("utf8")));
            child.once("error", (error) => {
                clearTimeout(timer);
                fail(error);
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                code === 0 ? done() : fail(new Error(`The setup step failed (exit code ${code}). See the log.`));
            });
        });
    }

    /** Asks the program to stop, and kills it when it does not leave within a few seconds. */
    private async killRuntime(runtime: Runtime): Promise<void> {
        runtime.stopping = true;
        try {
            if (runtime.server) {
                const server = runtime.server;
                runtime.server = null;
                await server.stop();
            }
            const child = runtime.child;
            if (child && runtime.exited) {
                child.kill("SIGTERM");
                const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
                await runtime.exited;
                clearTimeout(timer);
            }
        } finally {
            runtime.stopping = false;
            runtime.pid = 0;
        }
    }
}
