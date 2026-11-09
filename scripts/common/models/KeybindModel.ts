import {app} from "electron";
import {promises as fs} from "fs";
import {join} from "path";
import {isMap, isSeq, parse, parseDocument} from "yaml";
import type {KeybindAction, KeybindList} from "../CommonInterface";
import {isRecord, toText} from "../utils/GuardHelper";
import {DEFAULT_KEYBINDS_FILE} from "./DefaultFiles";
import {SerialQueue, writeFileAtomic} from "./FileModel";

interface RawAction {
    id: string;
    label: string;
    group: string;
    keys: string;
}

/**
 * Keybinds live in keybinds.yaml. The file is edited in place, so the comments in it survive when
 * the user changes a key in the settings page.
 */
export class KeybindModel {
    private readonly queue = new SerialQueue();

    get file(): string {
        return join(app.getPath("userData"), "keybinds.yaml");
    }

    async list(): Promise<KeybindList> {
        const defaults = this.parseActions(DEFAULT_KEYBINDS_FILE);
        const saved = new Map(this.parseActions(await this.readFile()).map((action) => [action.id, action]));

        const actions: KeybindAction[] = defaults.map((action) => ({
            id: action.id,
            label: action.label,
            group: action.group,
            keys: saved.get(action.id)?.keys ?? action.keys,
            defaultKeys: action.keys
        }));
        return {actions, file: this.file};
    }

    /** Sets the keys of one action. An empty string clears it. */
    set(id: string, keys: string): Promise<KeybindList> {
        return this.queue.run(async () => {
            const cleanKeys = keys.trim().slice(0, 40);
            const document = parseDocument(await this.readFile());
            const actions = document.get("actions");

            if (isSeq(actions)) {
                for (const item of actions.items) {
                    if (isMap(item) && item.get("id") === id) {
                        item.set("keys", cleanKeys);
                    }
                }
            }
            await writeFileAtomic(this.file, document.toString());
            return this.list();
        });
    }

    reset(): Promise<KeybindList> {
        return this.queue.run(async () => {
            await writeFileAtomic(this.file, DEFAULT_KEYBINDS_FILE);
            return this.list();
        });
    }

    /** The saved file, or the built-in one on the first run (which is then saved for the user to edit). */
    private async readFile(): Promise<string> {
        try {
            const text = await fs.readFile(this.file, "utf8");
            if (text.trim() === "") {
                throw new Error("empty"); // a leftover of a failed run: start again from the built-in file
            }
            return text;
        } catch {
            await writeFileAtomic(this.file, DEFAULT_KEYBINDS_FILE);
            return DEFAULT_KEYBINDS_FILE;
        }
    }

    private parseActions(source: string): RawAction[] {
        let raw: unknown;
        try {
            raw = parse(source);
        } catch {
            return [];
        }

        if (!isRecord(raw) || !Array.isArray(raw.actions)) {
            return [];
        }

        const actions: RawAction[] = [];
        for (const item of raw.actions) {
            if (!isRecord(item) || typeof item.id !== "string") {
                continue;
            }

            actions.push({
                id: item.id,
                label: toText(item.label, item.id, 80),
                group: toText(item.group, "Other", 40),
                keys: toText(item.keys, "", 40)
            });
        }
        return actions;
    }
}
