import {parse} from "yaml";
import type {EngineDefinition, EngineTerms, EngineType, SqlSettings} from "../CommonInterface";
import {DB_EXPORTER_IDS, ENGINE_FAMILIES} from "../projects/CosmosContract";
import {MAX_PORT} from "../projects/CosmosConfig";
import {isOneOf, isRecord, toBoolean, toNumber, toText} from "../utils/GuardHelper";
import type {ProblemList, RegistryFile} from "./RegistryTypes";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;
const TYPE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_ ()]{0,40}$/;
const AUTO_INCREMENT = ["none", "serial", "auto_increment", "identity", "autoincrement"] as const;

function parseTerms(raw: unknown): EngineTerms {
    const data = isRecord(raw) ? raw : {};
    return {
        container: toText(data.container, "Table", 30),
        containers: toText(data.containers, "Tables", 30),
        row: toText(data.row, "Row", 30),
        rows: toText(data.rows, "Rows", 30),
        field: toText(data.field, "Column", 30),
        fields: toText(data.fields, "Columns", 30)
    };
}

function parseSql(raw: unknown): SqlSettings {
    const data = isRecord(raw) ? raw : {};
    return {
        quote: ['"', "`", "["].includes(String(data.quote)) ? String(data.quote) : '"',
        autoIncrement: isOneOf(AUTO_INCREMENT, data.autoIncrement) ? data.autoIncrement : "none",
        tableSuffix: toText(data.tableSuffix, "", 200),
        header: toText(data.header, "", 2000),
        trueLiteral: toText(data.trueLiteral, "TRUE", 20),
        falseLiteral: toText(data.falseLiteral, "FALSE", 20)
    };
}

/** Reads the engine files. A broken file is reported and skipped; the first file with an id wins. */
export function parseEngines(files: RegistryFile[], problems: ProblemList): EngineDefinition[] {
    const engines: EngineDefinition[] = [];

    for (const file of files) {
        let raw: unknown;
        try {
            raw = parse(file.text);
        } catch (error) {
            problems.push(`${file.name}: ${(error as Error).message.split("\n")[0]}`);
            continue;
        }
        if (!isRecord(raw) || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
            problems.push(`${file.name}: an engine needs an "id" in lower case, for example "postgresql".`);
            continue;
        }
        if (engines.some((item) => item.id === raw.id)) {
            continue; // built-in files come first, so an extension cannot replace them
        }
        if (!isOneOf(ENGINE_FAMILIES, raw.family) || !isOneOf(DB_EXPORTER_IDS, raw.exporter)) {
            problems.push(`${file.name}: "family" and "exporter" must be one of the known values.`);
            continue;
        }

        const types: EngineType[] = (Array.isArray(raw.types) ? raw.types.slice(0, 80) : [])
            .filter(isRecord)
            .filter((item) => typeof item.id === "string" && TYPE_ID_PATTERN.test(item.id))
            .map((item) => ({id: String(item.id), label: toText(item.label, String(item.id), 40)}));
        if (types.length === 0) {
            problems.push(`${file.name}: an engine needs at least one entry in "types".`);
            continue;
        }

        const defaultType = types.some((item) => item.id === raw.defaultType) ? String(raw.defaultType) : types[0].id;
        const keyType = types.some((item) => item.id === raw.keyType) ? String(raw.keyType) : defaultType;

        engines.push({
            id: raw.id,
            name: toText(raw.name, raw.id, 60),
            description: toText(raw.description, "", 400),
            family: raw.family,
            exporter: raw.exporter,
            defaultPort: Math.round(toNumber(raw.defaultPort, 0, 0, MAX_PORT)),
            scriptExtension: toText(raw.scriptExtension, "txt", 10).replace(/[^A-Za-z0-9]/g, "") || "txt",
            terms: parseTerms(raw.terms),
            relations: toBoolean(raw.relations, raw.family === "relational"),
            defaultType,
            keyType,
            types,
            sql: parseSql(raw.sql),
            source: file.source
        });
    }
    return engines;
}
