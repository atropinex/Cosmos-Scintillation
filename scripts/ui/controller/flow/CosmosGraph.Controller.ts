import type {
    ApiGraph, ApiLink, ApiNode, LanguageSummary, NodeDefinition, PinDefinition
} from "../../../common/CommonInterface";
import type {Capability, PinType} from "../../../common/projects/CosmosContract";
import {MAX_COORDINATE} from "../../../common/projects/CosmosConfig";
import {makeId} from "../../../common/utils/IdHelper";

// =============================================================================================== //
// === Pure graph helpers: no React, no store, so they can be tested on their own === //
// =============================================================================================== //

export type FindDefinition = (kind: string) => NodeDefinition | undefined;

// === Node geometry (graph units). The node view and the wires both read these === //
export const NODE_WIDTH = 232;
export const NODE_HEADER = 30;
export const NODE_PAD = 6;
export const PIN_ROW = 26;
export const PROP_ROW = 30;
export const MAX_INLINE_PROPS = 3;

export interface Point {
    x: number;
    y: number;
}

/** Input pins in the left column, output pins in the right one, in file order. */
export function splitPins(definition: NodeDefinition | undefined): {inputs: PinDefinition[]; outputs: PinDefinition[]} {
    const pins = definition?.pins ?? [];
    return {inputs: pins.filter((pin) => pin.direction === "in"), outputs: pins.filter((pin) => pin.direction === "out")};
}

/** How tall a node is. Needed for culling and for the arrange step. */
export function nodeHeight(definition: NodeDefinition | undefined): number {
    const {inputs, outputs} = splitPins(definition);
    const rows = Math.max(inputs.length, outputs.length, 1);
    const props = Math.min(definition?.props.length ?? 0, MAX_INLINE_PROPS);
    return NODE_HEADER + NODE_PAD * 2 + rows * PIN_ROW + props * PROP_ROW;
}

/** Where a wire touches a pin, in graph units. */
export function pinAnchor(node: Point, definition: NodeDefinition | undefined, pinId: string, direction: "in" | "out"): Point | null {
    const {inputs, outputs} = splitPins(definition);
    const list = direction === "in" ? inputs : outputs;
    const index = list.findIndex((pin) => pin.id === pinId);
    if (index < 0) {
        return null;
    }
    return {
        x: node.x + (direction === "in" ? 0 : NODE_WIDTH),
        y: node.y + NODE_HEADER + NODE_PAD + index * PIN_ROW + PIN_ROW / 2
    };
}

/** A smooth horizontal curve from an output pin to an input pin. */
export function wirePath(from: Point, to: Point): string {
    const reach = Math.max(50, Math.abs(to.x - from.x) * 0.5);
    return `M${from.x} ${from.y}C${from.x + reach} ${from.y} ${to.x - reach} ${to.y} ${to.x} ${to.y}`;
}

export const pinKey = (nodeId: string, pinId: string, direction: "in" | "out") => `${nodeId}:${direction}:${pinId}`;

// === Looks === //

export const PIN_COLORS: Record<PinType, string> = {
    exec: "#f2f2f2",
    any: "#9aa3b2",
    string: "#f0a35e",
    number: "#5ed3a0",
    boolean: "#e8697a",
    list: "#b58cf0",
    object: "#5eb4f0"
};

/** Every category gets its own steady colour, even categories that extensions invent. */
export function categoryColor(category: string): string {
    let hash = 0;
    for (let index = 0; index < category.length; index++) {
        hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
    }
    return `hsl(${hash % 360} 58% 56%)`;
}

// === Connection rules === //

/** Exec only meets exec. Value pins match by type, and `any` matches every value type. */
export function pinTypesCompatible(a: PinType, b: PinType): boolean {
    if (a === "exec" || b === "exec") {
        return a === b;
    }
    return a === "any" || b === "any" || a === b;
}

export interface Ends {
    from: {node: string; pin: string};
    to: {node: string; pin: string};
}

export interface Verdict {
    ok: boolean;
    reason: string;
}

const NO: (reason: string) => Verdict = (reason) => ({ok: false, reason});

/** Whether following exec wires from `start` can reach `target`. */
export function reachesByExec(graph: ApiGraph, find: FindDefinition, start: string, target: string): boolean {
    const next = new Map<string, string[]>();
    for (const link of graph.links) {
        const node = graph.nodes.find((item) => item.id === link.from.node);
        const pin = find(node?.kind ?? "")?.pins.find((item) => item.id === link.from.pin);
        if (pin?.type === "exec") {
            next.set(link.from.node, [...(next.get(link.from.node) ?? []), link.to.node]);
        }
    }

    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
        const id = stack.pop() as string;
        if (id === target) {
            return true;
        }
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        stack.push(...(next.get(id) ?? []));
    }
    return false;
}

/** Can this output pin be wired to this input pin? Returns the plain reason when it can't. */
export function checkConnection(graph: ApiGraph, find: FindDefinition, ends: Ends): Verdict {
    if (ends.from.node === ends.to.node) {
        return NO("A node can't connect to itself");
    }

    const fromNode = graph.nodes.find((item) => item.id === ends.from.node);
    const toNode = graph.nodes.find((item) => item.id === ends.to.node);
    const fromPin = find(fromNode?.kind ?? "")?.pins.find((item) => item.id === ends.from.pin);
    const toPin = find(toNode?.kind ?? "")?.pins.find((item) => item.id === ends.to.pin);

    if (!fromNode || !toNode || !fromPin || !toPin) {
        return NO("That pin doesn't exist");
    }
    if (fromPin.direction !== "out" || toPin.direction !== "in") {
        return NO("Wires go from an output to an input");
    }
    if (!pinTypesCompatible(fromPin.type, toPin.type)) {
        return NO(fromPin.type === "exec" || toPin.type === "exec"
            ? "Flow pins only connect to flow pins"
            : `A ${fromPin.type} can't go into a ${toPin.type}`);
    }
    if (fromPin.type === "exec" && reachesByExec(graph, find, toNode.id, fromNode.id)) {
        return NO("That would make the flow run in a circle");
    }
    return {ok: true, reason: ""};
}

/** Adds a wire and drops the ones it replaces: one wire per value input, one wire per exec output. */
export function connect(graph: ApiGraph, find: FindDefinition, ends: Ends): ApiLink[] {
    const fromNode = graph.nodes.find((item) => item.id === ends.from.node);
    const execOut = find(fromNode?.kind ?? "")?.pins.find((item) => item.id === ends.from.pin)?.type === "exec";

    const kept = graph.links.filter((link) => {
        const sameInput = link.to.node === ends.to.node && link.to.pin === ends.to.pin;
        const sameExecOut = execOut && link.from.node === ends.from.node && link.from.pin === ends.from.pin;
        return !sameInput && !sameExecOut;
    });
    return [...kept, {id: makeId("lk"), from: {...ends.from}, to: {...ends.to}}];
}

/** Puts a dragged pair in output -> input order, or null when both are the same direction. */
export function orderEnds(
    graph: ApiGraph, find: FindDefinition,
    a: {node: string; pin: string}, b: {node: string; pin: string}
): Ends | null {
    const direction = (end: {node: string; pin: string}) => {
        const node = graph.nodes.find((item) => item.id === end.node);
        return find(node?.kind ?? "")?.pins.find((item) => item.id === end.pin)?.direction;
    };
    const first = direction(a);
    const second = direction(b);
    if (first === "out" && second === "in") {
        return {from: a, to: b};
    }
    if (first === "in" && second === "out") {
        return {from: b, to: a};
    }
    return null;
}

/** Every pin that a wire started at `pin` could end on, as pinKey() strings. */
export function compatiblePins(graph: ApiGraph, find: FindDefinition, start: {node: string; pin: string}): Set<string> {
    const result = new Set<string>();
    for (const node of graph.nodes) {
        for (const pin of find(node.kind)?.pins ?? []) {
            const ends = orderEnds(graph, find, start, {node: node.id, pin: pin.id});
            if (ends && checkConnection(graph, find, ends).ok) {
                result.add(pinKey(node.id, pin.id, pin.direction));
            }
        }
    }
    return result;
}

/** The first pin of a definition that a dragged wire could land on, used when a wire is dropped on empty space. */
export function firstCompatiblePin(definition: NodeDefinition, type: PinType, wantInput: boolean): PinDefinition | undefined {
    return definition.pins.find((pin) => pin.direction === (wantInput ? "in" : "out") && pinTypesCompatible(pin.type, type));
}

// === Changing the graph. Every function returns a new graph and leaves the old one alone === //

export function clampPoint(value: number): number {
    return Math.round(Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, Number.isFinite(value) ? value : 0)));
}

export function snap(value: number, grid: number, enabled: boolean): number {
    return enabled && grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

export function defaultProps(definition: NodeDefinition): ApiNode["props"] {
    const props: ApiNode["props"] = {};
    for (const prop of definition.props) {
        props[prop.key] = prop.default;
    }
    return props;
}

export function createNode(definition: NodeDefinition, x: number, y: number): ApiNode {
    return {id: makeId("n"), kind: definition.id, x: clampPoint(x), y: clampPoint(y), props: defaultProps(definition)};
}

export function removeNodes(graph: ApiGraph, ids: ReadonlySet<string>): ApiGraph {
    return {
        nodes: graph.nodes.filter((node) => !ids.has(node.id)),
        links: graph.links.filter((link) => !ids.has(link.from.node) && !ids.has(link.to.node))
    };
}

export interface Clip {
    nodes: ApiNode[];
    links: ApiLink[];
}

/** Takes the chosen nodes and the wires between them. */
export function takeClip(graph: ApiGraph, ids: ReadonlySet<string>): Clip {
    return {
        nodes: graph.nodes.filter((node) => ids.has(node.id)).map((node) => ({...node, props: {...node.props}})),
        links: graph.links.filter((link) => ids.has(link.from.node) && ids.has(link.to.node)).map((link) => ({...link}))
    };
}

/** Makes fresh ids for a clip, so pasting never collides with (or trusts) the old ids. */
export function cloneClip(clip: Clip, dx: number, dy: number): Clip & {map: Map<string, string>} {
    const map = new Map<string, string>();
    const nodes = clip.nodes.map((node) => {
        const id = makeId("n");
        map.set(node.id, id);
        return {...node, id, x: clampPoint(node.x + dx), y: clampPoint(node.y + dy), props: {...node.props}};
    });
    const links = clip.links
        .filter((link) => map.has(link.from.node) && map.has(link.to.node))
        .map((link) => ({
            id: makeId("lk"),
            from: {node: map.get(link.from.node) as string, pin: link.from.pin},
            to: {node: map.get(link.to.node) as string, pin: link.to.pin}
        }));
    return {nodes, links, map};
}

/** Cleans a graph that came from a file: no repeated ids, no wires to nothing, no self loops, no doubled inputs. */
export function sanitizeGraph(graph: ApiGraph, limit: number): ApiGraph {
    const nodeIds = new Set<string>();
    const nodes: ApiNode[] = [];
    for (const node of graph.nodes) {
        if (nodes.length >= limit || nodeIds.has(node.id)) {
            continue;
        }
        nodeIds.add(node.id);
        nodes.push({...node, x: clampPoint(node.x), y: clampPoint(node.y)});
    }

    const linkIds = new Set<string>();
    const inputs = new Set<string>();
    const links: ApiLink[] = [];
    for (const link of graph.links) {
        const input = `${link.to.node}:${link.to.pin}`;
        const fine = nodeIds.has(link.from.node) && nodeIds.has(link.to.node) && link.from.node !== link.to.node;
        if (!fine || linkIds.has(link.id) || inputs.has(input)) {
            continue;
        }
        linkIds.add(link.id);
        inputs.add(input);
        links.push(link);
    }
    return {nodes, links};
}

// === Hints: what is wrong with a node for the chosen language === //

/** Plain-language problems of one node. An empty list means the node is fine. */
export function validateNode(node: ApiNode, definition: NodeDefinition | undefined, language: LanguageSummary | undefined): string[] {
    if (!definition) {
        return [`Unknown node "${node.kind}". An extension may be missing.`];
    }

    const hints: string[] = [];
    if (language && !definition.languages.includes(language.id)) {
        hints.push(`No ${language.name} template for this node, so it will be skipped.`);
    }
    if (language && definition.capability !== "any" && !language.capabilities.includes(definition.capability)) {
        hints.push(`${language.name} can't generate ${definition.capability} nodes.`);
    }
    return hints;
}

/** The capabilities the graph needs, for example ["rest", "websocket"]. */
export function neededCapabilities(graph: ApiGraph, find: FindDefinition): Capability[] {
    const needed = new Set<Capability>();
    for (const node of graph.nodes) {
        const capability = find(node.kind)?.capability;
        if (capability && capability !== "any") {
            needed.add(capability);
        }
    }
    return [...needed];
}

/** Languages that can generate everything the graph uses. */
export function languagesFitting(languages: LanguageSummary[], needed: Capability[]): LanguageSummary[] {
    return languages.filter((language) => needed.every((capability) => language.capabilities.includes(capability)));
}

/** Why a palette entry doesn't fit the chosen language, or "" when it does. */
export function paletteReason(definition: NodeDefinition, language: LanguageSummary | undefined): string {
    if (!language) {
        return "";
    }
    if (!definition.languages.includes(language.id)) {
        return `No ${language.name} template`;
    }
    if (definition.capability !== "any" && !language.capabilities.includes(definition.capability)) {
        return `${language.name} can't do ${definition.capability}`;
    }
    return "";
}

// === Arrange: columns by how far a node is from the start of the flow === //

/** Returns new positions for every node. Left to right in the order of the wires, tidy rows inside a column. */
export function arrangeGraph(graph: ApiGraph, find: FindDefinition, grid: number): Map<string, Point> {
    const depth = new Map<string, number>();
    const incoming = new Map<string, string[]>();
    for (const node of graph.nodes) {
        incoming.set(node.id, []);
    }
    for (const link of graph.links) {
        incoming.get(link.to.node)?.push(link.from.node);
    }

    // Longest path from a start node. The visiting set protects against value wires that loop.
    const visiting = new Set<string>();
    const depthOf = (id: string): number => {
        const known = depth.get(id);
        if (known !== undefined) {
            return known;
        }
        if (visiting.has(id)) {
            return 0;
        }
        visiting.add(id);
        const value = Math.max(-1, ...(incoming.get(id) ?? []).map(depthOf)) + 1;
        visiting.delete(id);
        depth.set(id, value);
        return value;
    };

    const columns = new Map<number, ApiNode[]>();
    for (const node of graph.nodes) {
        const column = depthOf(node.id);
        columns.set(column, [...(columns.get(column) ?? []), node]);
    }

    const result = new Map<string, Point>();
    const gap = Math.max(grid, 40);
    const step = NODE_WIDTH + Math.max(gap, 72);
    for (const [column, nodes] of columns) {
        nodes.sort((a, b) => a.y - b.y);
        let y = 0;
        for (const node of nodes) {
            result.set(node.id, {x: clampPoint(column * step), y: clampPoint(y)});
            y += nodeHeight(find(node.kind)) + gap;
        }
    }
    return result;
}
