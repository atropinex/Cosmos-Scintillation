import {promises as fs} from "fs";
import {dirname, join} from "path";

/** Runs jobs strictly one after another, so two writes to the same file can never mix. */
export class SerialQueue {
    private queue: Promise<unknown> = Promise.resolve();

    run<R>(task: () => Promise<R>): Promise<R> {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }
}

/**
 * Writes a file so that a reader never sees half of it: the text goes to a temporary file first,
 * which is then renamed over the real one.
 */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
    const temporary = `${file}.tmp`;
    await fs.mkdir(dirname(file), {recursive: true});

    try {
        await fs.writeFile(temporary, text, "utf8");
        await fs.rename(temporary, file);
    } catch {
        await fs.writeFile(file, text, "utf8"); // e.g. the rename was blocked by antivirus; still save
    }
}

export async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

/** The first free name in a folder: "Name", then "Name 2", "Name 3" and so on. */
export async function freeName(folder: string, base: string, suffix = ""): Promise<string> {
    let name = base;
    let counter = 2;
    while (await fileExists(`${folder}/${name}${suffix}`)) {
        name = `${base} ${counter}`;
        counter++;
    }
    return name;
}

/**
 * Puts the built-in files into a folder. A file that is missing is only written when `fillMissing` is true (the first run).
 * A file that exists but is empty is always written again: it is a leftover from a failed run, and the user cannot have meant it.
 */
export async function seedFolder(folder: string, defaults: Record<string, string>, fillMissing: boolean): Promise<void> {
    for (const [name, text] of Object.entries(defaults)) {
        const file = join(folder, name);
        const current = await fs.readFile(file, "utf8").catch(() => null);
        if ((current === null && fillMissing) || (current !== null && current.trim() === "" && text.trim() !== "")) {
            await writeFileAtomic(file, text);
        }
    }
}
