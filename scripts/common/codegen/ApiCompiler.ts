import type {ApiLink, ApiNode, CosmosApi, CosmosDatabase, PinDefinition} from "../CommonInterface";
import {HTTP_METHODS} from "../projects/CosmosContract";
import {toBoolean} from "../utils/GuardHelper";
import type {CompileResult, LanguageSpec, NodeSpec, RouteInfo} from "./CodegenTypes";
import {parseRoutePath, stringLiteral} from "./StringLiteral";
import {fillTemplate, listPlaceholders, type Values} from "./TemplateEngine";

// === Graph -> code. Walks the exec wires from every route / wsEvent node. === //

/** Node kinds that start a flow. They are the only ones that are not reached through an exec wire. */
export const ROUTE_KIND = "route";
export const WS_EVENT_KIND = "wsEvent";
/** Node kinds that change stored data, for the security analysis. */
export const WRITE_KINDS: readonly string[] = ["dbInsert", "dbUpdate", "dbDelete"];
export const VALIDATE_KIND = "validate";

const MAX_EMITTED = 4000;
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,40}$/;

/** What is known at one point of a flow. Children get a copy, so a branch cannot see another branch's variables. */
interface Scope {
    /** Exec nodes that ran before this point: only their outputs may be used. */
    ran: Set<string>;
    /** Shared pure nodes that already have a variable. */
    declared: Set<string>;
    validated: boolean;
}

interface Entry {
    info: RouteInfo | null;
    kinds: Set<string>;
    context: "rest" | "websocket";
}

type Prop = string | number | boolean;

export function compileApi(api: CosmosApi, database: CosmosDatabase | null, language: LanguageSpec, specs: NodeSpec[]): CompileResult {
    return new Compiler(api, database, language, specs).run();
}

class Compiler {
    private readonly errors: string[] = [];
    private readonly warnings: string[] = [];
    private readonly nodes = new Map<string, ApiNode>();
    private readonly specs = new Map<string, NodeSpec>();
    private readonly incoming = new Map<string, ApiLink[]>();
    private readonly outgoing = new Map<string, ApiLink[]>();
    private readonly reached = new Set<string>();
    private pureStack = new Set<string>();
    private entry: Entry = {info: null, kinds: new Set(), context: "rest"};
    private emitted = 0;

    constructor(private readonly api: CosmosApi, private readonly database: CosmosDatabase | null, private readonly language: LanguageSpec, specs: NodeSpec[]) {
        for (const spec of specs) {
            this.specs.set(spec.id, spec);
        }
        for (const node of api.graph.nodes) {
            this.nodes.set(node.id, node);
        }
    }

    // === Entry point === //

    run(): CompileResult {
        const routeInfos: RouteInfo[] = [];
        const routes: string[] = [];
        const handlers: string[] = [];
        const wsEvents: string[] = [];
        const seen = new Set<string>();

        this.checkNodes();
        this.checkLinks();

        for (const node of this.nodes.values()) {
            const spec = this.specs.get(node.kind);
            if (!spec || !spec.templates[this.language.id]) {
                continue;
            }
            if (node.kind === ROUTE_KIND) {
                const code = this.compileRoute(node, spec, seen, routeInfos);
                if (code) {
                    routes.push(code);
                }
            } else if (node.kind === WS_EVENT_KIND) {
                const code = this.compileEvent(node, spec, seen, wsEvents);
                if (code) {
                    handlers.push(code);
                }
            }
        }

        if (routes.length === 0 && handlers.length === 0 && this.errors.length === 0) {
            this.warnings.push("The script has no route or WebSocket event node, so the exported API does nothing yet.");
        }
        for (const node of this.nodes.values()) {
            const spec = this.specs.get(node.kind);
            if (spec && !spec.pure && node.kind !== ROUTE_KIND && node.kind !== WS_EVENT_KIND && !this.reached.has(node.id)) {
                this.warnings.push(`${this.label(node)} is not connected to a route or event, so it was left out.`);
            }
        }
        return {routes: routes.join("\n\n"), wsHandlers: handlers.join("\n\n"), routeInfos, wsEvents, errors: this.errors, warnings: this.warnings};
    }

    // === Checks that do not need a walk === //

    private label(node: ApiNode): string {
        return `"${this.specs.get(node.kind)?.name ?? node.kind}" [${node.id}]`;
    }

    private checkNodes(): void {
        const capabilities = this.language.summary.capabilities;
        for (const node of this.nodes.values()) {
            const spec = this.specs.get(node.kind);
            if (!spec) {
                this.errors.push(`Unknown node kind "${node.kind}" [${node.id}]. Install the extension that provides it or delete the node.`);
            } else if (!spec.templates[this.language.id]) {
                this.errors.push(`${this.label(node)} has no code template for ${this.language.summary.name}. Delete the node or choose another language.`);
            } else if (spec.capability !== "any" && !capabilities.includes(spec.capability)) {
                this.errors.push(`${this.label(node)} needs ${spec.capability} support, which ${this.language.summary.name} does not offer.`);
            }
        }
    }

    private checkLinks(): void {
        for (const link of this.api.graph.links) {
            const from = this.nodes.get(link.from.node);
            const to = this.nodes.get(link.to.node);
            const fromSpec = from && this.specs.get(from.kind);
            const toSpec = to && this.specs.get(to.kind);
            if (!from || !to || !fromSpec || !toSpec) {
                continue; // an unknown kind is already reported
            }
            const fromPin = fromSpec.pins.find((pin) => pin.id === link.from.pin);
            const toPin = toSpec.pins.find((pin) => pin.id === link.to.pin);
            if (!fromPin || fromPin.direction !== "out" || !toPin || toPin.direction !== "in") {
                this.errors.push(`The wire from ${this.label(from)} to ${this.label(to)} does not join an output pin to an input pin.`);
                continue;
            }
            if ((fromPin.type === "exec") !== (toPin.type === "exec")) {
                this.errors.push(`A flow (exec) pin cannot be wired to a value pin: ${this.label(from)}.${fromPin.id} -> ${this.label(to)}.${toPin.id}.`);
            } else if (fromPin.type !== toPin.type && fromPin.type !== "any" && toPin.type !== "any") {
                this.errors.push(`Cannot wire ${fromPin.type} to ${toPin.type}: ${this.label(from)}.${fromPin.id} -> ${this.label(to)}.${toPin.id}.`);
            }

            this.push(this.incoming, `${to.id}|${toPin.id}`, link);
            this.push(this.outgoing, `${from.id}|${fromPin.id}`, link);
        }
        for (const [key, links] of this.incoming) {
            const [id, pin] = key.split("|");
            const node = this.nodes.get(id)!;
            if (links.length > 1 && this.specs.get(node.kind)!.pins.find((item) => item.id === pin)?.type !== "exec") {
                this.errors.push(`${this.label(node)}: the input "${pin}" has ${links.length} wires, a value input takes only one.`);
            }
        }
    }

    private push(map: Map<string, ApiLink[]>, key: string, link: ApiLink): void {
        const list = map.get(key);
        if (list) {
            list.push(link);
        } else {
            map.set(key, [link]);
        }
    }

    // === Entry nodes === //

    private begin(node: ApiNode, context: "rest" | "websocket"): void {
        this.entry = {info: null, kinds: new Set([node.kind]), context};
        this.reached.add(node.id);
    }

    private compileRoute(node: ApiNode, spec: NodeSpec, seen: Set<string>, infos: RouteInfo[]): string {
        const props = this.readProps(node, spec);
        const method = String(props.method ?? "GET").toUpperCase();
        if (!(HTTP_METHODS as readonly string[]).includes(method)) {
            this.errors.push(`${this.label(node)}: "${method}" is not a supported HTTP method.`);
            return "";
        }
        const path = parseRoutePath(this.api.basePath, String(props.path ?? ""));
        if (typeof path === "string") {
            this.errors.push(`${this.label(node)}: ${path}`);
            return "";
        }
        const key = `${method} ${path.shape}`;
        if (seen.has(key)) {
            this.errors.push(`Two routes answer ${method} ${path.colon}. A route must be unique.`);
            return "";
        }
        seen.add(key);

        const requireAuth = this.api.security.requireApiKey && !toBoolean(props.public, false);
        this.begin(node, "rest");
        const info: RouteInfo = {nodeId: node.id, method, path: path.colon, isPublic: !requireAuth, kinds: [], writesBeforeValidate: false};
        this.entry.info = info;

        const lower = method.toLowerCase();
        const extra: Values = {
            requireAuth: requireAuth ? this.language.literals.true : this.language.literals.false,
            "route.path": path.colon, "route.braces": path.braces, "route.method": method, "route.methodLower": lower,
            "route.methodPascal": lower[0].toUpperCase() + lower.slice(1),
            "route.params": path.params.map((name) => stringLiteral(name, this.language.stringStyle)).join(", "),
            "route.paramCount": String(path.params.length)
        };
        const code = this.emit(node, spec, this.freshScope(), extra, props);
        info.kinds = [...this.entry.kinds].sort();
        infos.push(info);
        return code;
    }

    private compileEvent(node: ApiNode, spec: NodeSpec, seen: Set<string>, events: string[]): string {
        const props = this.readProps(node, spec);
        const name = String(props.event ?? "");
        if (!EVENT_NAME.test(name)) {
            this.errors.push(`${this.label(node)}: the event name "${name}" must start with a letter and use letters, digits and - _ . :`);
            return "";
        }
        if (seen.has(`ws ${name}`)) {
            this.errors.push(`Two WebSocket nodes handle the event "${name}". An event must be unique.`);
            return "";
        }
        seen.add(`ws ${name}`);
        events.push(name);
        this.begin(node, "websocket");
        return this.emit(node, spec, this.freshScope(), {}, props);
    }

    private freshScope(): Scope {
        return {ran: new Set(), declared: new Set(), validated: false};
    }

    // === Walking exec wires === //

    /** The code of one exec node, with everything that follows it nested through its `{{flow.*}}` placeholders. */
    private emit(node: ApiNode, spec: NodeSpec, scope: Scope, extra: Values = {}, known?: Record<string, Prop>): string {
        if (++this.emitted > MAX_EMITTED) {
            if (this.emitted === MAX_EMITTED + 1) {
                this.errors.push(`The script is too large or has too many merging wires (more than ${MAX_EMITTED} steps).`);
            }
            return "";
        }
        this.reached.add(node.id);
        this.entry.kinds.add(node.kind);
        if (this.entry.context !== (spec.capability === "any" ? this.entry.context : spec.capability)) {
            this.errors.push(`${this.label(node)} cannot be used in a ${this.entry.context === "rest" ? "route" : "WebSocket event"}.`);
        }
        if (WRITE_KINDS.includes(node.kind) && !scope.validated && this.entry.info) {
            this.entry.info.writesBeforeValidate = true;
        }

        const props = known ?? this.readProps(node, spec);
        const template = this.withMarkers(node, spec);
        const used = new Set(listPlaceholders(template));
        const pre: string[] = [];
        const values: Values = {...extra, id: node.id};
        const here: Scope = {ran: scope.ran, declared: new Set(scope.declared), validated: scope.validated};

        for (const pin of spec.pins) {
            if (pin.direction === "in" && pin.type !== "exec" && used.has(`in.${pin.id}`)) {
                values[`in.${pin.id}`] = this.input(node, pin, here, pre);
            } else if (pin.direction === "out" && pin.type !== "exec") {
                values[`out.${pin.id}`] = this.variable(node, pin.id);
                values[`used.${pin.id}`] = this.outgoing.has(`${node.id}|${pin.id}`) ? "" : fillTemplate(this.language.usedMarker, {name: this.variable(node, pin.id)});
            }
        }
        for (const [key, value] of Object.entries(props)) {
            values[`prop.${key}`] = String(value);
            values[`str.${key}`] = stringLiteral(String(value), this.language.stringStyle);
        }

        const child: Scope = {ran: new Set(scope.ran).add(node.id), declared: here.declared, validated: scope.validated || node.kind === VALIDATE_KIND};
        for (const pin of spec.pins) {
            if (pin.direction === "out" && pin.type === "exec" && used.has(`flow.${pin.id}`)) {
                values[`flow.${pin.id}`] = this.follow(node, pin.id, child);
            }
        }
        const code = fillTemplate(template, values).replace(/\s+$/, "");
        return [...pre, code].join("\n");
    }

    /** The template, with a `{{used.<pin>}}` line added before the first `{{flow.*}}` line (or at the end) for outputs nobody reads. */
    private withMarkers(node: ApiNode, spec: NodeSpec): string {
        const template = spec.templates[this.language.id].replace(/\s+$/, "");
        if (!this.language.usedMarker) {
            return template;
        }
        const outs = spec.pins.filter((pin) => pin.direction === "out" && pin.type !== "exec" && !this.outgoing.has(`${node.id}|${pin.id}`));
        if (outs.length === 0) {
            return template;
        }
        const lines = template.split("\n");
        const index = lines.findIndex((line) => /^\s*\{\{\s*flow\./.test(line));
        const markers = outs.map((pin) => `{{used.${pin.id}}}`);
        if (index < 0) {
            return [...lines, ...markers].join("\n");
        }
        const indent = /^\s*/.exec(lines[index])![0];
        lines.splice(index, 0, ...markers.map((marker) => indent + marker));
        return lines.join("\n");
    }

    private follow(node: ApiNode, pin: string, scope: Scope): string {
        const links = this.outgoing.get(`${node.id}|${pin}`) ?? [];
        if (links.length > 1) {
            this.warnings.push(`${this.label(node)}: the flow output "${pin}" has ${links.length} wires, only the first one is used.`);
        }
        const target = links[0] && this.nodes.get(links[0].to.node);
        const spec = target && this.specs.get(target.kind);
        if (!target || !spec || !spec.templates[this.language.id]) {
            return "";
        }
        if (scope.ran.has(target.id) || target.id === node.id) {
            this.errors.push(`The flow loops back to ${this.label(target)}. Loops are not supported; remove the wire that closes the circle.`);
            return "";
        }
        return this.emit(target, spec, scope);
    }

    // === Values === //

    private variable(node: ApiNode, pin: string): string {
        return `v_${node.id}_${pin}`;
    }

    /** The expression for one input pin: a wired variable, a wired pure expression, or the pin's own value. */
    private input(node: ApiNode, pin: PinDefinition, scope: Scope, pre: string[]): string {
        const link = this.incoming.get(`${node.id}|${pin.id}`)?.[0];
        const source = link && this.nodes.get(link.from.node);
        const sourceSpec = source && this.specs.get(source.kind);
        if (!link || !source || !sourceSpec) {
            return this.literal(node, pin);
        }
        if (!sourceSpec.pure) {
            if (!scope.ran.has(source.id)) {
                this.errors.push(`${this.label(node)} uses a result of ${this.label(source)}, but that node does not run before it on this path.`);
            }
            return this.variable(source, link.from.pin);
        }
        return this.pure(source, sourceSpec, scope, pre);
    }

    private pure(node: ApiNode, spec: NodeSpec, scope: Scope, pre: string[]): string {
        const name = this.variable(node, "value");
        if (scope.declared.has(node.id)) {
            return name;
        }
        if (this.pureStack.has(node.id)) {
            this.errors.push(`${this.label(node)} depends on itself through its inputs.`);
            return this.language.literals.null;
        }
        if (!spec.templates[this.language.id]) {
            return this.language.literals.null;
        }
        this.pureStack.add(node.id);
        const props = this.readProps(node, spec);
        const template = spec.templates[this.language.id].replace(/\s+/g, " ").trim();
        const used = new Set(listPlaceholders(template));
        const values: Values = {id: node.id};
        for (const pin of spec.pins) {
            if (pin.direction === "in" && pin.type !== "exec" && used.has(`in.${pin.id}`)) {
                values[`in.${pin.id}`] = this.input(node, pin, scope, pre);
            }
        }
        for (const [key, value] of Object.entries(props)) {
            values[`prop.${key}`] = String(value);
            values[`str.${key}`] = stringLiteral(String(value), this.language.stringStyle);
        }
        this.pureStack.delete(node.id);

        const expression = fillTemplate(template, values);
        if ((this.outgoing.get(`${node.id}|value`)?.length ?? 0) > 1) {
            pre.push(fillTemplate(this.language.declare, {name, expr: expression}));
            scope.declared.add(node.id);
            return name;
        }
        return expression;
    }

    /** What an unconnected input uses: the value typed on the node, else the pin's default, else null. */
    private literal(node: ApiNode, pin: PinDefinition): string {
        const language = this.language;
        const typed = node.props[`pin_${pin.id}`];
        const raw = typed !== undefined ? typed : pin.default;
        if (raw === undefined || (raw === "" && pin.type !== "string" && pin.type !== "any")) {
            return language.literals.null;
        }
        const wrap = (kind: "string" | "number" | "boolean", literal: string) => fillTemplate(language.wrap[kind], {v: literal});
        switch (pin.type) {
            case "number": {
                const number = Number(raw);
                if (!Number.isFinite(number)) {
                    this.errors.push(`${this.label(node)}: the value "${String(raw)}" of "${pin.id}" is not a number.`);
                    return language.literals.null;
                }
                return wrap("number", String(number));
            }
            case "boolean":
                return wrap("boolean", raw === true || raw === "true" ? language.literals.true : language.literals.false);
            case "list":
                return raw === "[]" ? language.literals.list : language.literals.null;
            case "object":
                return raw === "{}" ? language.literals.object : language.literals.null;
            case "string":
                return wrap("string", stringLiteral(String(raw), language.stringStyle));
            default:
                if (typeof raw === "number") {
                    return wrap("number", String(raw));
                }
                return typeof raw === "boolean" ? wrap("boolean", raw ? language.literals.true : language.literals.false) : wrap("string", stringLiteral(String(raw), language.stringStyle));
        }
    }

    // === Properties === //

    /** The node's properties, checked against the definition. A table or column becomes its name in the database. */
    private readProps(node: ApiNode, spec: NodeSpec): Record<string, Prop> {
        const result: Record<string, Prop> = {};
        let table: {name: string; columns: Array<{id: string; name: string}>} | null = null;

        for (const prop of spec.props) {
            const raw = node.props[prop.key] ?? prop.default;
            let value: Prop = raw;
            if (prop.type === "number") {
                value = Number(raw);
                if (!Number.isFinite(value)) {
                    this.errors.push(`${this.label(node)}: "${prop.label}" must be a number.`);
                    value = Number(prop.default) || 0;
                }
            } else if (prop.type === "boolean") {
                value = raw === true || raw === "true";
            } else if (prop.type === "select") {
                value = String(raw);
                if (prop.options && !prop.options.some((option) => option.value === value)) {
                    this.errors.push(`${this.label(node)}: "${String(raw)}" is not one of the choices of "${prop.label}".`);
                    value = String(prop.default);
                }
            } else if (prop.type === "table") {
                const found = this.database?.tables.find((item) => item.id === raw || item.name === raw);
                if (!found) {
                    this.errors.push(this.database
                        ? `${this.label(node)}: the table "${String(raw)}" does not exist in the database "${this.database.name}".`
                        : `${this.label(node)} needs a database table, but no database is bound to this API.`);
                }
                table = found ?? null;
                value = found?.name ?? "";
            } else if (prop.type === "column") {
                const found = table?.columns.find((item) => item.id === raw || item.name === raw);
                if (String(raw) !== "" && !found && table) {
                    this.errors.push(`${this.label(node)}: the column "${String(raw)}" does not exist in the table "${table.name}".`);
                }
                value = found?.name ?? "";
            } else {
                value = String(raw);
            }
            result[prop.key] = value;
        }
        return result;
    }
}
