import {parse} from "yaml";
import type {LanguageSummary} from "../CommonInterface";
import type {Dependency, FileTemplate, LanguageSpec, PackageSpec, StringStyle} from "../codegen/CodegenTypes";
import {CAPABILITIES, type Capability} from "../projects/CosmosContract";
import {isOneOf, isRecord, toBoolean, toText} from "../utils/GuardHelper";
import type {ProblemList, RegistryFile} from "./RegistryTypes";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;
const FILE_PATH = /^[A-Za-z0-9_.\-/{}]+$/;
const MAX_TEMPLATE = 60000;

const text = (value: unknown, fallback: string, max = MAX_TEMPLATE) => toText(value, fallback, max);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 200) : []);

function toDependency(value: unknown): Dependency | null {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.version !== "string") {
        return null;
    }
    return {name: value.name.slice(0, 120), version: value.version.slice(0, 60), dev: toBoolean(value.dev, false), when: text(value.when, "", 20)};
}

const strings = (value: unknown): string[] => list(value).filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 500));

/** Reads the language files. A broken file is reported and skipped; the others still load. */
export function parseLanguages(files: RegistryFile[], problems: ProblemList): {specs: LanguageSpec[]; summaries: LanguageSummary[]} {
    const specs: LanguageSpec[] = [];

    for (const file of files) {
        let raw: unknown;
        try {
            raw = parse(file.text);
        } catch (error) {
            problems.push(`${file.name}: ${(error as Error).message.split("\n")[0]}`);
            continue;
        }
        if (!isRecord(raw) || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
            problems.push(`${file.name}: a language needs an "id" in lower case, for example "go".`);
            continue;
        }
        if (specs.some((item) => item.id === raw.id)) {
            continue; // the first file with an id wins, so built-in files cannot be replaced by an extension
        }

        const packages: PackageSpec[] = list(raw.packages).filter(isRecord).map((item) => ({
            id: text(item.id, "", 40),
            name: text(item.name, "", 60),
            description: text(item.description, "", 200),
            dependencies: list(item.dependencies).map(toDependency).filter((dep): dep is Dependency => dep !== null),
            imports: strings(item.imports),
            setup: strings(item.setup)
        })).filter((item) => ID_PATTERN.test(item.id));

        const files_: FileTemplate[] = list(raw.files).filter(isRecord).map((item) => ({
            path: text(item.path, "", 200),
            template: text(item.template, ""),
            when: text(item.when, "", 20)
        })).filter((item) => FILE_PATH.test(item.path) && !item.path.includes("..") && !item.path.startsWith("/"));

        if (files_.length === 0) {
            problems.push(`${file.name}: a language needs at least one file in "files".`);
            continue;
        }

        const capabilities = list(raw.capabilities).filter((item): item is Capability => isOneOf(CAPABILITIES, item));
        const literals = isRecord(raw.literals) ? raw.literals : {};
        const wrap = isRecord(raw.wrap) ? raw.wrap : {};
        const websocket = isRecord(raw.websocket) ? raw.websocket : {};

        const summary: LanguageSummary = {
            id: raw.id,
            name: text(raw.name, raw.id, 60),
            description: text(raw.description, "", 300),
            capabilities: capabilities.length > 0 ? capabilities : ["rest"],
            runtime: text(raw.runtime, "", 80),
            runCommand: text(raw.runCommand, "", 120),
            packages: packages.map(({id, name, description}) => ({id, name, description})),
            source: file.source
        };

        specs.push({
            id: raw.id,
            summary,
            stringStyle: (isOneOf(["default", "ruby", "rust"] as const, raw.stringStyle) ? raw.stringStyle : "default") as StringStyle,
            indent: text(raw.indent, "    ", 8),
            literals: {
                null: text(literals.null, "null", 40), true: text(literals.true, "true", 40), false: text(literals.false, "false", 40),
                object: text(literals.object, "{}", 40), list: text(literals.list, "[]", 40)
            },
            wrap: {string: text(wrap.string, "{{v}}", 80), number: text(wrap.number, "{{v}}", 80), boolean: text(wrap.boolean, "{{v}}", 80)},
            declare: text(raw.declare, "const {{name}} = {{expr}};", 200),
            usedMarker: text(raw.usedMarker, "", 100),
            dependencies: list(raw.dependencies).map(toDependency).filter((dep): dep is Dependency => dep !== null),
            dependencyFormat: text(raw.dependencyFormat, "{{name}} {{version}}", 200),
            devDependencyFormat: text(raw.devDependencyFormat, text(raw.dependencyFormat, "{{name}} {{version}}", 200), 200),
            dependencySeparator: text(raw.dependencySeparator, "\n", 20),
            packages,
            wsImports: strings(websocket.imports),
            wsSetup: text(websocket.setup, ""),
            files: files_
        });
        specs[specs.length - 1].summary.capabilities = summary.capabilities;
    }

    return {specs, summaries: specs.map((spec) => spec.summary)};
}
