// === Smoke test: builds a small API for every language and checks the security markers === //
// Run with: npx tsx tools/smoke.ts   (needs no Electron)
import {readdirSync, readFileSync} from "fs";
import {join} from "path";
import {parseLanguages} from "../scripts/common/models/LanguageModel";
import {parseNodes} from "../scripts/common/models/NodeModel";
import {parseEngines} from "../scripts/common/models/EngineModel";
import {buildApi} from "../scripts/common/exporters/ApiExporter";
import {createApi} from "../scripts/common/utils/ProjectFactory";
import type {CosmosApi, CosmosDatabase} from "../scripts/common/CommonInterface";

const load = (folder: string) => readdirSync(join(__dirname, "../scripts/defaults", folder))
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => ({name, text: readFileSync(join(__dirname, "../scripts/defaults", folder, name), "utf8"), source: "built-in"}));

const problems: string[] = [];
const languages = parseLanguages(load("languages"), problems).specs;
const nodes = parseNodes(load("nodes"), problems).specs;
const engines = parseEngines(load("engines"), problems);
console.log(`languages=${languages.length} nodes=${nodes.length} engines=${engines.length} problems=${problems.length}`);
problems.forEach((line) => console.log("  problem:", line));

const EVIL = "a\"b\\c${x}{{id}}\n'; DROP";
const database = {
    id: "db1", name: "Shop", engine: "sqlite",
    tables: [{id: "t1", name: "items", x: 0, y: 0, columns: [
        {id: "c1", name: "id", type: "INTEGER", primary: true, autoIncrement: true, nullable: false, unique: false, default: "", ref: null},
        {id: "c2", name: "title", type: "TEXT", primary: false, autoIncrement: false, nullable: false, unique: false, default: "", ref: null}
    ]}]
} as unknown as CosmosDatabase;

const api = (language: string): CosmosApi => ({
    id: "a1", name: "Todo", language, packages: [], databaseId: "db1", port: 8080, basePath: "/api",
    security: {requireApiKey: true, allowedOrigins: [], rateLimitPerMinute: 60, maxBodyKb: 64},
    graph: {
        nodes: [
            {id: "n1", kind: "route", x: 0, y: 0, props: {method: "GET", path: "/items"}},
            {id: "n2", kind: "dbFind", x: 0, y: 0, props: {table: "t1"}},
            {id: "n3", kind: "respond", x: 0, y: 0, props: {}},
            {id: "n4", kind: "textValue", x: 0, y: 0, props: {pin_text: EVIL}},
            {id: "n5", kind: "log", x: 0, y: 0, props: {}}
        ],
        links: [
            {id: "l1", from: {node: "n1", pin: "then"}, to: {node: "n2", pin: "in"}},
            {id: "l2", from: {node: "n2", pin: "then"}, to: {node: "n3", pin: "in"}},
            {id: "l3", from: {node: "n2", pin: "rows"}, to: {node: "n3", pin: "body"}}
        ]
    }
} as unknown as CosmosApi);

const presets: CosmosApi[] = [];
let failed = 0;
for (const language of languages) {
  for (const preset of ["custom", "hello", "crud", "websocket"] as const) {
    const subject = preset === "custom" ? api(language.id) : createApi("Test", language.id, "db1", preset, database.tables[0]);
    const build = buildApi(subject, database, {languages, nodes, engines}, false);
    const all = build.files.map((file) => file.content).join("\n");
    const checks: [string, boolean][] = [
        ["no errors", build.errors.length === 0],
        ["has files", build.files.length > 0],
        ["no unreplaced placeholders", !/\{\{[a-zA-Z.]+\}\}/.test(all.replace(EVIL, ""))],
        ["mentions rate limit", /rate/i.test(all)],
        ["mentions api key", /api[-_ ]?key/i.test(all)]
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0 || build.errors.length > 0) {
        failed++;
    }
    console.log(`${bad.length ? "FAIL" : "ok  "} ${language.id}/${preset}: ${build.files.length} files${bad.length ? " -> " + bad.join(", ") : ""}${build.errors.length ? " | " + build.errors.slice(0, 3).join(" | ") : ""}`);
  }
}
void presets;

// === The tester runs the CRUD preset against an empty safe copy === //
import {runApiRequest, runSocketEvent, emptySandbox} from "../scripts/common/tester/GraphRunner";
{
    const defs = new Map(nodes.map((node) => [node.id, node]));
    const crud = createApi("T", "typescript", "db1", "crud", database.tables[0]);
    const context = {api: crud, database, definitions: defs, sandbox: emptySandbox(database)};
    const call = (method: string, path: string, body?: unknown) => runApiRequest(context, {method, path, query: "", headers: {}, body, sendKey: true});
    const post = call("POST", "/api/items", {title: "milk"});
    const list = call("GET", "/api/items");
    const one = call("GET", "/api/items/1");
    const bad = call("POST", "/api/items", {});
    const del = call("DELETE", "/api/items/1");
    const after = call("GET", "/api/items");
    const noKey = runApiRequest(context, {method: "GET", path: "/api/items", query: "", headers: {}, body: null, sendKey: false});
    const checks: [string, boolean][] = [
        ["POST 201", post.status === 201], ["list has 1", Array.isArray(list.body) && list.body.length === 1],
        ["read one", (one.body as {title?: string})?.title === "milk"], ["empty body 400", bad.status === 400],
        ["delete 204", del.status === 204], ["list empty after", Array.isArray(after.body) && after.body.length === 0],
        ["no key 401", noKey.status === 401], ["unknown 404", call("GET", "/api/nope").status === 404]
    ];
    const chat = createApi("C", "typescript", "db1", "websocket");
    const reply = runSocketEvent({api: chat, database, definitions: defs, sandbox: emptySandbox(database)}, {event: "ping", data: null});
    checks.push(["ws pong", reply.replies[0]?.data === "pong"]);
    for (const [name, ok] of checks) { console.log(ok ? "ok  " : "FAIL", "tester:", name); if (!ok) { failed++; } }
    if (failed) { console.log(JSON.stringify({post, bad}, null, 1).slice(0, 800)); }
}
process.exit(failed ? 1 : 0);
