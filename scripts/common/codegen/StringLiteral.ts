import type {StringStyle} from "./CodegenTypes";

// === Safe string literals and route paths === //

const hex = (code: number, width: number) => code.toString(16).toUpperCase().padStart(width, "0");

/**
 * Writes any text as a double-quoted literal that cannot end early, cannot contain a line break and cannot interpolate.
 * Quotes, backslashes, control characters, line separators, "$" (JS, Kotlin, shell style) and, for Ruby, "#" are escaped.
 */
export function stringLiteral(value: string, style: StringStyle = "default"): string {
    let result = "\"";
    for (const char of value) {
        const code = char.codePointAt(0)!;
        if (char === "\\") {
            result += "\\\\";
        } else if (char === "\"") {
            result += "\\\"";
        } else if (char === "\n") {
            result += "\\n";
        } else if (char === "\r") {
            result += "\\r";
        } else if (char === "\t") {
            result += "\\t";
        } else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 || char === "$" || (char === "#" && style === "ruby")) {
            result += style === "default" ? `\\u${hex(code, 4)}` : `\\u{${hex(code, 1)}}`;
        } else {
            result += char;
        }
    }
    return result + "\"";
}

// === Routes === //

const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^(?::([A-Za-z_][A-Za-z0-9_]{0,30})|\{([A-Za-z_][A-Za-z0-9_]{0,30})\})$/;

export interface RoutePath {
    /** `/api/items/:id` */
    colon: string;
    /** `/api/items/{id}` */
    braces: string;
    /** `/api/items/:` with the names removed: two routes with the same shape clash. */
    shape: string;
    params: string[];
}

/** Joins the base path and a route path (colon or brace style). Returns an error text for a path that is not allowed. */
export function parseRoutePath(basePath: string, path: string): RoutePath | string {
    const joined = `${basePath === "/" ? "" : basePath}/${path.trim().replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
    if (joined.length > 200 || !joined.startsWith("/")) {
        return `The path "${path}" is not a valid route path.`;
    }

    const params: string[] = [];
    const colon: string[] = [];
    const braces: string[] = [];
    const shape: string[] = [];
    for (const segment of joined.split("/").slice(1)) {
        const param = PARAM.exec(segment);
        if (param) {
            const name = param[1] ?? param[2];
            if (params.includes(name)) {
                return `The path "${path}" uses the parameter "${name}" twice.`;
            }
            params.push(name);
            colon.push(`:${name}`);
            braces.push(`{${name}}`);
            shape.push(":");
        } else if (segment === "" && joined === "/") {
            continue;
        } else if (SEGMENT.test(segment) && segment !== "." && segment !== ".." && !segment.includes("..")) {
            colon.push(segment);
            braces.push(segment);
            shape.push(segment);
        } else {
            return `The path "${path}" has a part that is not allowed ("${segment}"). Use letters, digits, - _ . ~ and :name or {name}.`;
        }
    }
    return {colon: "/" + colon.join("/"), braces: "/" + braces.join("/"), shape: "/" + shape.join("/"), params};
}
