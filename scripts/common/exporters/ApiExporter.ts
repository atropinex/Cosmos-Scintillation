import {randomBytes} from "crypto";
import {stringify} from "yaml";
import type {ApiExportPreview, CosmosApi, CosmosColumn, CosmosDatabase, EngineDefinition, SecurityFinding} from "../CommonInterface";
import {compileApi} from "../codegen/ApiCompiler";
import type {BuildRegistry, CompileResult, Dependency, LanguageSpec, RouteInfo} from "../codegen/CodegenTypes";
import {stringLiteral} from "../codegen/StringLiteral";
import {fillTemplate, type Values} from "../codegen/TemplateEngine";
import {toKebab, toPascalIdentifier} from "../utils/IdHelper";
import type {GeneratedFile} from "./ExportTypes";
import {analyzeSecurity} from "./SecurityAnalyzer";

// === Script + language files -> a folder with a runnable project === //

export interface ApiBuild extends ApiExportPreview {
    /** Reasons the export cannot be written. Empty when the files are complete. */
    errors: string[];
}

const KEY_PLACEHOLDER = "(a new random key is made when you export)";
const SAFE_PATH = /^[A-Za-z0-9_.\-/]+$/;

/** The folder-relative path, or an error text. Absolute paths, "..", backslashes and odd characters are never allowed. */
export function checkPath(path: string): string | null {
    const parts = path.split("/");
    if (!path || path.length > 200 || path.startsWith("/") || !SAFE_PATH.test(path) || parts.some((part) => part === "" || part === "." || part === ".." || part.includes(".."))) {
        return `The path "${path}" is not allowed in an export.`;
    }
    return null;
}

/** Engine type text -> what the generated data store checks: string, int, float, bool, json or date. */
export function columnKind(type: string, engine: EngineDefinition | undefined): string {
    const text = type.toLowerCase().trim();
    if (engine?.exporter === "mongo") {
        return ({int: "int", long: "int", double: "float", decimal: "float", bool: "bool", date: "date", object: "json", array: "json"} as Record<string, string>)[text] ?? "string";
    }
    if (engine?.exporter === "redis") {
        return ({integer: "int", float: "float", boolean: "bool", json: "json", list: "json", set: "json", zset: "json", hash: "json"} as Record<string, string>)[text] ?? "string";
    }
    if (/^(bool|boolean|bit)\b/.test(text)) {
        return "bool";
    }
    if (/^(tinyint|smallint|mediumint|bigint|int|integer|serial|bigserial|smallserial)\b/.test(text)) {
        return "int";
    }
    if (/^(real|float|double|decimal|numeric|money|smallmoney|number)\b/.test(text)) {
        return "float";
    }
    if (/^(json|jsonb)\b/.test(text)) {
        return "json";
    }
    return /^(date|time|timestamp|datetime|datetime2|datetimeoffset|timestamptz)\b/.test(text) ? "date" : "string";
}

function schemaOf(database: CosmosDatabase | null, engine: EngineDefinition | undefined, notes: string[]): {tables: unknown[]} {
    const tables: unknown[] = [];
    for (const table of database?.tables ?? []) {
        if (table.columns.length === 0) {
            notes.push(`The table "${table.name}" has no columns, so it is not part of the data store.`);
            continue;
        }
        const primary = table.columns.find((column: CosmosColumn) => column.primary);
        tables.push({
            name: table.name,
            primary: primary?.name ?? "",
            columns: table.columns.map((column: CosmosColumn) => ({
                name: column.name,
                kind: columnKind(column.type, engine),
                primary: column.primary,
                unique: column.unique,
                nullable: column.nullable && !column.primary,
                auto: column.autoIncrement,
                default: column.default
            }))
        });
    }
    return {tables};
}

const dedupe = (lines: string[]) => [...new Set(lines)];

function renderDependencies(language: LanguageSpec, extra: Dependency[], websocket: boolean, dev: boolean): string {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const dependency of [...language.dependencies, ...extra]) {
        if ((dependency.when && !(dependency.when === "websocket" && websocket)) || dependency.dev !== dev || seen.has(dependency.name)) {
            continue;
        }
        seen.add(dependency.name);
        lines.push(fillTemplate(dev ? language.devDependencyFormat : language.dependencyFormat, {name: dependency.name, version: dependency.version}));
    }
    return lines.join(language.dependencySeparator);
}

/** One `.env` value on one line: no line breaks, no quotes, so a hostile origin cannot add a variable. */
const envValue = (text: string) => text.replace(/[^A-Za-z0-9:/._*\-[\],]/g, "");

// === Files the language does not write === //

function envFile(api: CosmosApi, key: string, example: boolean): string {
    const origins = api.security.allowedOrigins.map(envValue).filter(Boolean).join(",");
    return [
        example ? `# Copy this file to .env and fill in API_KEY.` : `# Settings of ${envValue(api.name)}. Keep this file private: it holds the API key.`,
        `API_KEY=${example ? "" : key}`,
        `# Browser origins that may call the API, comma separated. Empty = no cross-origin access.`,
        `ALLOWED_ORIGINS=${origins}`,
        `MAX_BODY_KB=${api.security.maxBodyKb}`,
        `RATE_LIMIT_PER_MIN=${api.security.rateLimitPerMinute}`,
        `PORT=${api.port}`,
        `HOST=127.0.0.1`,
        `REQUEST_TIMEOUT_SECONDS=15`,
        `DATA_DIR=data`,
        ""
    ].join("\n");
}

const GITIGNORE = [".env", "data/", "node_modules/", "dist/", "target/", "bin/", "obj/", "vendor/", "__pycache__/", "*.pyc", ".venv/", ""].join("\n");

function readme(api: CosmosApi, language: LanguageSpec, routes: RouteInfo[], events: string[], packages: string[]): string {
    const lines = [
        `# ${api.name}`, "", `Generated by Cosmos-Scintillation (${language.summary.name}).`, "",
        "## Run", "", `Needs ${language.summary.runtime || "the language runtime"}.`, "", "```", language.summary.runCommand, "```", "",
        `The server listens on 127.0.0.1:${api.port} (set \`HOST\` and \`PORT\` in \`.env\`). Put a reverse proxy with HTTPS in front of it before it faces the internet.`, "",
        "## Settings (`.env`)", "",
        "| Variable | Meaning |", "|---|---|",
        "| `API_KEY` | Secret for the `X-API-Key` header. A new random one was made for this export. |",
        "| `ALLOWED_ORIGINS` | Browser origins that may call the API, comma separated. Empty means none. |",
        "| `MAX_BODY_KB` | Largest request body. |", "| `RATE_LIMIT_PER_MIN` | Requests per client and minute. 0 turns it off. |",
        "| `PORT`, `HOST` | Where the server listens. |", "| `REQUEST_TIMEOUT_SECONDS` | Time limit for a request. |", "| `DATA_DIR` | Where `store.json` is saved. |", "",
        "## Routes", ""
    ];
    for (const info of routes) {
        lines.push(`- \`${info.method} ${info.path}\`${info.isPublic ? " (public)" : ""}`);
    }
    if (routes.length === 0) {
        lines.push("- none");
    }
    if (events.length > 0) {
        lines.push("", "## WebSocket", "", "Connect to `/ws` with the `x-api-key` header or `?key=...`. Messages are JSON: `{\"event\":\"name\",\"data\":{}}`.", "", `Events: ${events.map((event) => `\`${event}\``).join(", ")}`);
    }
    lines.push("", "## Using the API", "", "```", `curl -H "X-API-Key: $API_KEY" http://127.0.0.1:${api.port}${api.basePath === "/" ? "" : api.basePath}/...`, "```", "");
    if (packages.length > 0) {
        lines.push(`Add-ons: ${packages.join(", ")}.`, "");
    }
    lines.push("## Security", "", "Headers, CORS allow-list, body limit, rate limit, key check and error hiding are in the runtime file. The data store only accepts columns that exist in the schema. Files in `data/` are plain JSON: back them up, and do not share `.env`.", "");
    return lines.join("\n");
}

const OPENAPI_TYPES: Record<string, Record<string, unknown>> = {
    string: {type: "string"}, int: {type: "integer"}, float: {type: "number"}, bool: {type: "boolean"}, date: {type: "string"}, json: {}
};

function openApi(api: CosmosApi, schema: {tables: unknown[]}, routes: RouteInfo[], events: string[]): string {
    const schemas: Record<string, unknown> = {};
    for (const table of schema.tables as Array<{name: string; columns: Array<{name: string; kind: string; nullable: boolean}>}>) {
        const properties: Record<string, unknown> = {};
        for (const column of table.columns) {
            properties[column.name] = {...OPENAPI_TYPES[column.kind], ...(column.nullable ? {nullable: true} : {})};
        }
        schemas[table.name] = {type: "object", properties, required: table.columns.filter((column) => !column.nullable).map((column) => column.name)};
    }

    const paths: Record<string, Record<string, unknown>> = {};
    const used = new Set<string>();
    for (const info of routes) {
        const braces = info.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
        const names = [...braces.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
        let operationId = (info.method.toLowerCase() + toPascalIdentifier(braces, "Root"));
        while (used.has(operationId)) {
            operationId += "_";
        }
        used.add(operationId);
        const method = info.method.toLowerCase();
        paths[braces] = {
            ...paths[braces],
            [method]: {
                operationId,
                ...(names.length > 0 ? {parameters: names.map((name) => ({name, in: "path", required: true, schema: {type: "string"}}))} : {}),
                ...(["post", "put", "patch"].includes(method) ? {requestBody: {content: {"application/json": {schema: {type: "object"}}}}} : {}),
                ...(info.isPublic ? {} : {security: [{ApiKeyAuth: []}]}),
                responses: {
                    "200": {description: "OK", content: {"application/json": {schema: {}}}},
                    "204": {description: "No content"},
                    "400": {description: "Invalid input", content: {"application/json": {schema: {$ref: "#/components/schemas/Error"}}}},
                    "401": {description: "Missing or wrong API key"},
                    "429": {description: "Rate limit reached"},
                    "500": {description: "Internal error", content: {"application/json": {schema: {$ref: "#/components/schemas/Error"}}}}
                }
            }
        };
    }
    return stringify({
        openapi: "3.0.3",
        info: {title: api.name, version: "1.0.0", description: events.length > 0 ? `WebSocket at /ws. Events: ${events.join(", ")}` : "Generated by Cosmos-Scintillation."},
        servers: [{url: `http://127.0.0.1:${api.port}`}],
        paths,
        components: {
            securitySchemes: {ApiKeyAuth: {type: "apiKey", in: "header", name: "X-API-Key"}},
            schemas: {Error: {type: "object", properties: {error: {type: "string"}}}, ...schemas}
        }
    });
}

// === Entry point === //

/**
 * Builds every file of the exported project. Nothing is written here. With `preview` true the .env shows a placeholder
 * instead of a real key, because the key only exists once the files are written.
 */
export function buildApi(api: CosmosApi, database: CosmosDatabase | null, registry: BuildRegistry, preview: boolean): ApiBuild {
    const empty = (errors: string[]): ApiBuild => ({files: [], notes: errors.map((error) => `Problem: ${error}`), security: [], errors});
    const language = registry.languages.find((item) => item.id === api.language);
    if (!language) {
        return empty([`The language "${api.language}" is not installed. Choose another one in the API settings.`]);
    }

    const compiled: CompileResult = compileApi(api, database, language, registry.nodes);
    const websocket = compiled.wsEvents.length > 0;
    const errors = [...compiled.errors];
    if (websocket && !language.summary.capabilities.includes("websocket")) {
        errors.push(`${language.summary.name} cannot make WebSocket servers.`);
    }
    const packages = language.packages.filter((item) => api.packages.includes(item.id));
    const notes = compiled.warnings.map((warning) => `Warning: ${warning}`);
    const missing = api.packages.filter((id) => !language.packages.some((item) => item.id === id));
    if (missing.length > 0) {
        notes.push(`Warning: these add-ons do not exist for ${language.summary.name} and were skipped: ${missing.join(", ")}.`);
    }
    if (errors.length > 0) {
        return {files: [], notes: [...errors.map((error) => `Problem: ${error}`), ...notes], security: [], errors};
    }

    const engine = registry.engines.find((item) => item.id === database?.engine);
    const schema = schemaOf(database, engine, notes);
    const style = language.stringStyle;
    const slug = toKebab(api.name, "api");
    const extraDependencies = packages.flatMap((item) => item.dependencies);

    const values: Values = {
        appName: api.name.replace(/[\r\n]+/g, " "),
        appSlug: slug,
        appPascal: toPascalIdentifier(api.name, "App"),
        appSnake: slug.replace(/-/g, "_"),
        port: String(api.port),
        maxBodyKb: String(api.security.maxBodyKb),
        maxBodyBytes: String(api.security.maxBodyKb * 1024),
        rateLimit: String(api.security.rateLimitPerMinute),
        requireApiKey: api.security.requireApiKey ? language.literals.true : language.literals.false,
        imports: dedupe(packages.flatMap((item) => item.imports)).join("\n"),
        setup: dedupe(packages.flatMap((item) => item.setup)).join("\n"),
        routes: compiled.routes,
        wsImports: websocket ? dedupe(language.wsImports).join("\n") : "",
        wsHandlers: compiled.wsHandlers,
        wsSetup: websocket ? fillTemplate(language.wsSetup, {wsHandlers: compiled.wsHandlers}) : "",
        dependencies: renderDependencies(language, extraDependencies, websocket, false),
        devDependencies: renderDependencies(language, extraDependencies, websocket, true),
        schemaJson: stringLiteral(JSON.stringify(schema), style)
    };

    const files = new Map<string, GeneratedFile>();
    for (const file of language.files) {
        if (file.when && !(file.when === "websocket" && websocket)) {
            continue;
        }
        const path = fillTemplate(file.path, values);
        const problem = checkPath(path);
        if (problem) {
            errors.push(problem);
            continue;
        }
        files.set(path, {path, content: fillTemplate(file.template, values).replace(/\s*$/, "\n")});
    }

    const key = preview ? KEY_PLACEHOLDER : randomBytes(32).toString("hex");
    const extra: GeneratedFile[] = [
        {path: ".env", content: envFile(api, key, false)},
        {path: ".env.example", content: envFile(api, "", true)},
        {path: ".gitignore", content: GITIGNORE},
        {path: "README.md", content: readme(api, language, compiled.routeInfos, compiled.wsEvents, packages.map((item) => item.name))},
        {path: "openapi.yaml", content: openApi(api, schema, compiled.routeInfos, compiled.wsEvents)}
    ];
    for (const file of extra) {
        files.set(file.path, file);
    }

    const security: SecurityFinding[] = analyzeSecurity(api.security, compiled.routeInfos, compiled.wsEvents);
    notes.push(`${language.summary.name}: ${language.summary.runCommand}`);
    return {files: [...files.values()], notes, security, errors};
}
