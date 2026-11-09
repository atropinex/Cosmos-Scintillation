const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A short random id such as "n_k3j9x2ab". The prefix says what kind of thing it names. */
export function makeId(prefix: string): string {
    let text = "";
    for (let index = 0; index < 8; index++) {
        text += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return `${prefix}_${text}`;
}

/** "Play Button!" -> "PlayButton". Safe to use as a class or variable name in code. */
export function toPascalIdentifier(text: string, fallback = "Item"): string {
    const words = text.match(/[A-Za-z0-9]+/g) ?? [];
    const joined = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
    const safe = /^[0-9]/.test(joined) ? `N${joined}` : joined;
    return safe || fallback;
}

/** "Play Button!" -> "playButton". */
export function toCamelIdentifier(text: string, fallback = "item"): string {
    const pascal = toPascalIdentifier(text, fallback);
    return pascal[0].toLowerCase() + pascal.slice(1);
}

/** "Play Button!" -> "play-button". Safe to use as a file name or a CSS class. */
export function toKebab(text: string, fallback = "item"): string {
    const words = text.match(/[A-Za-z0-9]+/g) ?? [];
    return words.map((word) => word.toLowerCase()).join("-") || fallback;
}
