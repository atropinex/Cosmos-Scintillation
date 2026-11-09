import type {ApiSecurity, SecurityFinding} from "../CommonInterface";
import {WRITE_KINDS} from "../codegen/ApiCompiler";
import type {RouteInfo} from "../codegen/CodegenTypes";

// === What the export dialog tells the user about the API's safety === //

const HIGH_RATE_LIMIT = 6000;
const BIG_BODY_KB = 1024;
const HUGE_BODY_KB = 10240;

const writes = (info: RouteInfo) => info.kinds.some((kind) => WRITE_KINDS.includes(kind));
const named = (infos: RouteInfo[]) => {
    const shown = infos.slice(0, 4).map((info) => `${info.method} ${info.path}`).join(", ");
    return infos.length > 4 ? `${shown} and ${infos.length - 4} more` : shown;
};

/**
 * Reads the settings and the compiled routes. A loosened setting is a "warn" or "risk", a setting that is on is "ok",
 * so the dialog shows what protects the API as well as what does not. Risks come first.
 */
export function analyzeSecurity(security: ApiSecurity, routes: RouteInfo[], wsEvents: string[]): SecurityFinding[] {
    const found: SecurityFinding[] = [];
    const add = (level: SecurityFinding["level"], message: string) => found.push({level, message});

    // === Who may call === //
    if (!security.requireApiKey) {
        add("risk", "The API key is switched off: anyone who can reach the server can call every route.");
    } else {
        add("ok", "Every route needs the X-API-Key header (compared in constant time). The server refuses to start without an API_KEY.");
        const open = routes.filter((info) => info.isPublic);
        if (open.length > 0) {
            add("warn", `${open.length} route${open.length === 1 ? " is" : "s are"} public and skip the key: ${named(open)}.`);
        }
    }

    const openWrites = routes.filter((info) => info.isPublic && writes(info));
    if (openWrites.length > 0) {
        add("risk", `A public route changes data without a key: ${named(openWrites)}. Anyone can fill or wipe the data.`);
    }
    const unchecked = routes.filter((info) => info.writesBeforeValidate);
    if (unchecked.length > 0) {
        add("warn", `Data is written before a "Validate" node checks it: ${named(unchecked)}. The store still drops unknown columns and checks types.`);
    } else if (routes.some(writes)) {
        add("ok", "Every route that changes data checks its input with a Validate node first.");
    }

    // === Browsers === //
    const origins = security.allowedOrigins;
    if (origins.includes("*")) {
        add("risk", "Allowed origins is \"*\": any website may call the API from a visitor's browser.");
    } else if (origins.length === 0) {
        add("ok", "No cross-origin access (ALLOWED_ORIGINS is empty). Only non-browser clients and the same site can call it.");
    } else {
        add("ok", `Browsers may call the API only from: ${origins.join(", ")}.`);
        const plain = origins.filter((origin) => /^http:\/\//i.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(origin));
        if (plain.length > 0) {
            add("warn", `Allowed origin without HTTPS: ${plain.join(", ")}.`);
        }
    }

    // === Limits === //
    if (security.rateLimitPerMinute <= 0) {
        add("risk", "The rate limit is off: one client can flood the server.");
    } else if (security.rateLimitPerMinute > HIGH_RATE_LIMIT) {
        add("warn", `The rate limit of ${security.rateLimitPerMinute} requests per minute per client is very high.`);
    } else {
        add("ok", `Each client may send ${security.rateLimitPerMinute} requests per minute.`);
    }
    if (security.maxBodyKb >= HUGE_BODY_KB) {
        add("risk", `Request bodies up to ${security.maxBodyKb} KB are accepted, which makes memory attacks easy.`);
    } else if (security.maxBodyKb > BIG_BODY_KB) {
        add("warn", `Request bodies up to ${security.maxBodyKb} KB are accepted. Most APIs need far less.`);
    } else {
        add("ok", `Request bodies are limited to ${security.maxBodyKb} KB.`);
    }

    // === Always on === //
    if (wsEvents.length > 0) {
        add(security.requireApiKey ? "ok" : "warn", security.requireApiKey
            ? "WebSocket connections check the origin and the API key, and limit message size and message rate."
            : "WebSocket connections are open to everyone (no key). Origin, message size and message rate are still checked.");
    }
    add("ok", "Security headers (nosniff, frame deny, no referrer, default-src 'none') are set on every answer.");
    add("ok", "Unexpected errors answer {\"error\":\"internal_error\"} and never show internals. The data store accepts only columns of the schema.");

    const rank = {risk: 0, warn: 1, ok: 2};
    return found.sort((a, b) => rank[a.level] - rank[b.level]);
}
