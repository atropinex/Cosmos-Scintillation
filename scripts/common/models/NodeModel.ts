import {parse} from "yaml";
import type {NodeDefinition, NodePropDefinition, PinDefinition, SelectOption} from "../CommonInterface";
import type {NodeSpec} from "../codegen/CodegenTypes";
import {CAPABILITIES, PIN_DIRECTIONS, PIN_TYPES, PROPERTY_TYPES, type NodeCapability, type PropValue} from "../projects/CosmosContract";
import {isOneOf, isRecord, toBoolean, toNumber, toText} from "../utils/GuardHelper";
import type {ProblemList, RegistryFile} from "./RegistryTypes";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const MAX_NODES_PER_FILE = 200;
const MAX_TEMPLATE = 20000;

type Raw = Record<string, unknown>;

interface Pending {
    definition: Raw | null;
    source: string;
    templates: Record<string, string>;
}

const toPropValue = (value: unknown, fallback: PropValue): PropValue => {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : fallback;
};

function toOptions(value: unknown): SelectOption[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const options = value.filter(isRecord).map((item) => ({
        value: toText(item.value, "", 80),
        label: toText(item.label, toText(item.value, "", 80), 80)
    }));
    return options.length > 0 ? options.slice(0, 60) : undefined;
}

/**
 * Reads the node files. Several files may describe the same node: the first one with pins and props is the
 * definition, every other file only adds its code templates (a "template patch"). This is how an extension
 * adds a language.
 */
export function parseNodes(files: RegistryFile[], problems: ProblemList): {specs: NodeSpec[]; summaries: NodeDefinition[]} {
    const pending = new Map<string, Pending>();

    for (const file of files) {
        let raw: unknown;
        try {
            raw = parse(file.text);
        } catch (error) {
            problems.push(`${file.name}: ${(error as Error).message.split("\n")[0]}`);
            continue;
        }
        if (!isRecord(raw)) {
            problems.push(`${file.name}: expected a YAML mapping at the top level.`);
            continue;
        }

        const entries: unknown[] = Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES_PER_FILE) : [raw];
        for (const entry of entries) {
            if (!isRecord(entry) || typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
                problems.push(`${file.name}: a node needs an "id" made of letters, digits and "_".`);
                continue;
            }

            const item = pending.get(entry.id) ?? {definition: null, source: file.source, templates: {}};
            if (!item.definition && Array.isArray(entry.pins)) {
                item.definition = entry;
                item.source = file.source;
            }
            if (isRecord(entry.templates)) {
                for (const [language, template] of Object.entries(entry.templates)) {
                    if (typeof template === "string" && !(language in item.templates) && /^[a-z0-9-]{1,30}$/.test(language)) {
                        item.templates[language] = template.slice(0, MAX_TEMPLATE);
                    }
                }
            }
            pending.set(entry.id, item);
        }
    }

    const specs: NodeSpec[] = [];
    for (const [id, item] of pending) {
        if (!item.definition) {
            problems.push(`Node "${id}": only code templates were found, no definition with pins.`);
            continue;
        }
        const spec = toSpec(id, item, problems);
        if (spec) {
            specs.push(spec);
        }
    }

    const summaries = specs.map(({templates: _templates, ...summary}) => summary);
    return {specs, summaries};
}

function toPin(raw: unknown): PinDefinition | null {
    if (!isRecord(raw) || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
        return null;
    }
    const type = isOneOf(PIN_TYPES, raw.type) ? raw.type : "any";
    const pin: PinDefinition = {
        id: raw.id,
        name: toText(raw.name, "", 40),
        direction: isOneOf(PIN_DIRECTIONS, raw.direction) ? raw.direction : "in",
        type
    };
    if (raw.default !== undefined && type !== "exec") {
        pin.default = toPropValue(raw.default, "");
    }
    return pin;
}

function toProp(raw: unknown): NodePropDefinition | null {
    if (!isRecord(raw) || typeof raw.key !== "string" || !ID_PATTERN.test(raw.key)) {
        return null;
    }
    const type = isOneOf(PROPERTY_TYPES, raw.type) ? raw.type : "text";
    const options = toOptions(raw.options);
    const first = options?.[0]?.value ?? "";
    const prop: NodePropDefinition = {
        key: raw.key,
        label: toText(raw.label, raw.key, 40),
        type,
        default: type === "number" ? toNumber(raw.default, 0) : toPropValue(raw.default, type === "boolean" ? false : first)
    };
    if (options) {
        prop.options = options;
    }
    if (typeof raw.hint === "string") {
        prop.hint = raw.hint.slice(0, 200);
    }
    return prop;
}

function toSpec(id: string, item: Pending, problems: ProblemList): NodeSpec | null {
    const raw = item.definition!;
    const pins = (raw.pins as unknown[]).map(toPin).filter((pin): pin is PinDefinition => pin !== null).slice(0, 24);
    const props = (Array.isArray(raw.props) ? raw.props : []).map(toProp).filter((prop): prop is NodePropDefinition => prop !== null).slice(0, 24);
    const pure = toBoolean(raw.pure, false);

    if (pure) {
        const outs = pins.filter((pin) => pin.direction === "out");
        if (outs.length !== 1 || outs[0].id !== "value" || pins.some((pin) => pin.type === "exec")) {
            problems.push(`Node "${id}": a pure node needs exactly one output pin "value" and no exec pins.`);
            return null;
        }
    }
    if (new Set(pins.map((pin) => pin.id)).size !== pins.length) {
        problems.push(`Node "${id}": pin ids must be unique.`);
        return null;
    }

    const capability: NodeCapability = raw.capability === "any" || isOneOf(CAPABILITIES, raw.capability) ? (raw.capability as NodeCapability) : "any";
    return {
        id,
        name: toText(raw.name, id, 60),
        category: toText(raw.category, "Other", 40),
        description: toText(raw.description, "", 300),
        pure,
        capability,
        pins,
        props,
        languages: Object.keys(item.templates).sort(),
        source: item.source,
        templates: item.templates
    };
}
