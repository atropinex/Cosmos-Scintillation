// === Placeholder filling for the YAML code templates (see docs/FORMATS.md) === //

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g;
const ALONE = /^([ \t]*)\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}[ \t]*$/;

export type Values = Record<string, string>;

/** Puts `indent` in front of every line but the first one. Empty lines stay empty. */
export function indentRest(text: string, indent: string): string {
    return text.split("\n").map((line, index) => (index === 0 || line === "" ? line : indent + line)).join("\n");
}

/**
 * Replaces `{{key}}` with `values[key]`. A placeholder that is alone on its line becomes all the lines of its value,
 * each with that line's indentation (an empty value removes the line). Unknown placeholders stay as they are, so code
 * that really contains "{{" survives. The text is read once from left to right, so a value that itself contains
 * "{{x}}" (for example a user's string) is never expanded again.
 */
export function fillTemplate(template: string, values: Values): string {
    const known = (key: string) => Object.prototype.hasOwnProperty.call(values, key);
    const output: string[] = [];

    for (const line of template.split("\n")) {
        const alone = ALONE.exec(line);
        if (alone && known(alone[2])) {
            const value = values[alone[2]];
            if (value !== "") {
                for (const part of value.split("\n")) {
                    output.push(part === "" ? "" : alone[1] + part);
                }
            }
            continue;
        }
        const indent = /^[ \t]*/.exec(line)![0];
        output.push(line.replace(PLACEHOLDER, (whole, key: string) => (known(key) ? indentRest(values[key], indent) : whole)));
    }
    return output.join("\n");
}

/** Placeholders a template uses, for example to find out which `{{flow.*}}` pins it expects. */
export function listPlaceholders(template: string): string[] {
    return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
}
