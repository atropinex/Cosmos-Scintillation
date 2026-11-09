// === What "automatic" means for a column === //

/** Number columns count up. Every other kind of column gets a unique id (a uuid, or an ObjectId for MongoDB). */
export function autoMode(type: string): "count" | "id" {
    const name = type.toLowerCase();
    const number = /^(serial|bigserial|int|integer|bigint|smallint|tinyint|mediumint|long)\b/.test(name) || /(int|integer|serial)$/.test(name);
    return number ? "count" : "id";
}

/** A new unique id that fits the column's type. */
export function newAutoId(type: string): string {
    if (type.toLowerCase() === "objectid") {
        return Array.from({length: 24}, () => Math.floor(Math.random() * 16).toString(16)).join("");
    }
    // Available in Node and in the window, so this file can be used by both.
    return globalThis.crypto.randomUUID();
}
