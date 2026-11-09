import {app} from "electron";
import {promises as fs} from "fs";
import {join} from "path";
import {parse, stringify} from "yaml";
import {SerialQueue, writeFileAtomic} from "./FileModel";

/**
 * One YAML file in the app's data folder.
 *
 * Every change is "read the file, change it, write it back". Two of those running at once would each
 * start from the same old data and the second would erase the first, so changes run one at a time.
 */
export class YamlStoreModel<T> {
    private readonly queue = new SerialQueue();

    /** `parseValue` turns whatever is on disk (or `undefined` if there is nothing) into a valid value. */
    constructor(private readonly fileName: string, private readonly parseValue: (raw: unknown) => T) {
    }

    get file(): string {
        return join(app.getPath("userData"), this.fileName);
    }

    async read(): Promise<T> {
        try {
            return this.parseValue(parse(await fs.readFile(this.file, "utf8")));
        } catch {
            return this.parseValue(undefined); // first run, or an unreadable file
        }
    }

    /** Applies a change to the saved value. Safe to call many times at once. */
    update(change: (value: T) => T): Promise<T> {
        return this.queue.run(async () => {
            const next = change(await this.read());
            await writeFileAtomic(this.file, stringify(next, {lineWidth: 0}));
            return next;
        });
    }
}
