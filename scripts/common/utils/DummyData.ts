import type {CosmosColumn} from "../CommonInterface";
import {autoMode, newAutoId} from "./ColumnHelper";

// === Made-up values for testing: they follow the column's name first, then its type === //

export type Rng = () => number;

const FIRST = ["Ava", "Liam", "Noah", "Mia", "Ethan", "Sofia", "Lucas", "Isla", "Mateo", "Zoe", "Kai", "Nora", "Leo", "Aria", "Ezra", "Maya", "Jonas", "Lena", "Omar", "Ines"];
const LAST = ["Santos", "Reyes", "Garcia", "Cruz", "Tanaka", "Silva", "Nguyen", "Khan", "Rossi", "Muller", "Novak", "Okafor", "Lopez", "Berg", "Costa", "Ivanov"];
const WORDS = ["amber", "river", "signal", "market", "forest", "orbit", "harbor", "pixel", "meadow", "copper", "lantern", "summit", "breeze", "ember", "canvas", "garden", "cobalt", "voyage", "willow", "quartz"];
const CITIES = ["Manila", "Cebu", "Davao", "Tokyo", "Lisbon", "Oslo", "Austin", "Nairobi", "Lima", "Hanoi", "Porto", "Seoul"];
const COUNTRIES = ["Philippines", "Japan", "Portugal", "Norway", "United States", "Kenya", "Peru", "Vietnam", "Korea", "Brazil"];
const COMPANIES = ["Northwind", "Contoso", "Globex", "Initech", "Umbra", "Vertex", "Lumen", "Acme"];
const STATUSES = ["active", "pending", "done", "archived", "draft"];
const ROLES = ["admin", "editor", "viewer", "member"];
const SENTENCES = [
    "A short note written for testing.", "This row was filled in automatically.", "Nothing here is real data.",
    "Check that this text shows up everywhere it should.", "Made up by the dummy data tool."
];

const pick = <T,>(list: T[], rng: Rng): T => list[Math.floor(rng() * list.length)];
const between = (min: number, max: number, rng: Rng) => Math.floor(rng() * (max - min + 1)) + min;
const pad = (value: number) => String(value).padStart(2, "0");

function randomDate(rng: Rng): Date {
    // Within the last two years, so the dates look current.
    return new Date(Date.now() - Math.floor(rng() * 730 * 86400000));
}

/** The longest text a column can hold, from a type such as varchar(40). Unlimited when the type says nothing. */
function limitOf(type: string): number {
    const match = /\((\d+)\)/.exec(type);
    return match && /char|text|string/i.test(type) ? Number(match[1]) : 100000;
}

/** A value for one column as text, the way a person would type it in the grid. `index` keeps unique values apart. */
export function dummyValue(column: CosmosColumn, index: number, rng: Rng): string {
    const name = column.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const type = column.type.toLowerCase();
    const first = pick(FIRST, rng);
    const last = pick(LAST, rng);
    const unique = column.unique || column.primary;
    const suffix = unique ? `${index + 1}${between(10, 99, rng)}` : "";
    const has = (pattern: RegExp) => pattern.test(name);
    let value: string | null = null;

    if (/^(bool|boolean|bit)/.test(type)) {
        return rng() < 0.5 ? "true" : "false";
    }
    if (/^(uuid|guid)/.test(type) || type === "char(36)") {
        return newAutoId("uuid");
    }
    if (type === "objectid") {
        return newAutoId("objectid");
    }

    if (has(/e ?mail/)) {
        value = `${first}.${last}${suffix}@example.com`.toLowerCase();
    } else if (has(/user ?name|handle|login|nick/)) {
        value = `${first}${last[0]}${suffix || between(1, 99, rng)}`.toLowerCase();
    } else if (has(/^(first|given)( name)?$/)) {
        value = first;
    } else if (has(/^(last|sur|family)( name)?$/)) {
        value = last;
    } else if (has(/^(full )?name$|^customer$|^author$|^owner$/)) {
        value = `${first} ${last}`;
    } else if (has(/phone|mobile|tel/)) {
        value = `+63 9${between(10, 99, rng)} ${between(100, 999, rng)} ${between(1000, 9999, rng)}`;
    } else if (has(/address|street/)) {
        value = `${between(1, 999, rng)} ${pick(WORDS, rng)} street`;
    } else if (has(/city|town/)) {
        value = pick(CITIES, rng);
    } else if (has(/country|nation/)) {
        value = pick(COUNTRIES, rng);
    } else if (has(/zip|postal/)) {
        value = String(between(10000, 99999, rng));
    } else if (has(/url|website|link|image|avatar|photo|picture|icon/)) {
        value = `https://example.com/${pick(WORDS, rng)}${suffix ? "-" + suffix : ""}`;
    } else if (has(/colou?r/)) {
        value = `#${between(0, 0xffffff, rng).toString(16).padStart(6, "0")}`;
    } else if (has(/company|organi[sz]ation|^org$|brand|vendor|employer/)) {
        value = pick(COMPANIES, rng);
    } else if (has(/^ip( address)?$/)) {
        value = `${between(11, 223, rng)}.${between(0, 255, rng)}.${between(0, 255, rng)}.${between(1, 254, rng)}`;
    } else if (has(/password|token|secret|hash|salt/)) {
        value = Array.from({length: 32}, () => between(0, 15, rng).toString(16)).join("");
    } else if (has(/slug/)) {
        value = `${pick(WORDS, rng)}-${pick(WORDS, rng)}${suffix ? "-" + suffix : ""}`;
    } else if (has(/status|state|stage/)) {
        value = pick(STATUSES, rng);
    } else if (has(/role|type|kind|category/)) {
        value = pick(ROLES, rng);
    } else if (has(/gender|sex/)) {
        value = pick(["female", "male", "other"], rng);
    } else if (has(/title|subject|headline|label/)) {
        const text = `${pick(WORDS, rng)} ${pick(WORDS, rng)}`;
        value = `${text[0].toUpperCase()}${text.slice(1)}${suffix ? " " + suffix : ""}`;
    } else if (has(/desc|bio|about|summary|content|body|note|comment|message|text|detail/)) {
        value = `${pick(SENTENCES, rng)} ${pick(SENTENCES, rng)}`;
    }

    if (value === null) {
        // Numbers by name, then by type.
        const isNumber = /(int|serial|long|float|double|decimal|numeric|real|number|money)/.test(type);
        if (isNumber) {
            const whole = autoMode(type) === "count";
            if (has(/age/)) {
                return String(between(18, 80, rng));
            }
            if (has(/rating|score|stars?|level/)) {
                return String(between(1, 5, rng));
            }
            if (has(/price|cost|amount|total|salary|balance|fee|revenue/)) {
                return whole ? String(between(5, 999, rng)) : (between(500, 99999, rng) / 100).toFixed(2);
            }
            if (has(/qty|quantity|count|stock|number|size|length|weight/)) {
                return String(between(1, 100, rng));
            }
            if (/tinyint/.test(type)) {
                return String(between(0, 100, rng));
            }
            return whole ? String(unique ? index * 7 + between(1, 6, rng) + 1000 : between(1, 1000, rng)) : (between(0, 99999, rng) / 100).toFixed(2);
        }
        if (/^(timestamp|datetime|timestamptz)/.test(type) || has(/(created|updated|deleted|time|at)$/)) {
            return randomDate(rng).toISOString();
        }
        if (/^date/.test(type) || has(/date|birthday|born|dob/)) {
            const date = randomDate(rng);
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        }
        if (/^time/.test(type)) {
            return `${pad(between(0, 23, rng))}:${pad(between(0, 59, rng))}:00`;
        }
        if (/^(json|jsonb|object)/.test(type)) {
            return JSON.stringify({note: pick(SENTENCES, rng), n: between(1, 99, rng)});
        }
        if (/^array/.test(type)) {
            return JSON.stringify([pick(WORDS, rng), pick(WORDS, rng)]);
        }
        value = `${pick(WORDS, rng)} ${pick(WORDS, rng)}${suffix ? " " + suffix : ""}`;
    }
    return value.length > limitOf(column.type) ? value.slice(0, limitOf(column.type)) : value;
}

/** Fills the columns that need a value. Automatic columns are left out so the app creates them. */
export function dummyRow(columns: CosmosColumn[], index: number, rng: Rng, refs: Map<string, string[]> = new Map()): Record<string, string> {
    const row: Record<string, string> = {};
    for (const column of columns) {
        if (column.autoIncrement) {
            continue;
        }
        if (column.ref) {
            const choices = refs.get(column.id) ?? [];
            if (choices.length > 0) {
                row[column.name] = pick(choices, rng);
            }
            continue;
        }
        if (column.default !== "" && rng() < 0.3) {
            row[column.name] = column.default;
            continue;
        }
        row[column.name] = dummyValue(column, index, rng);
    }
    return row;
}
