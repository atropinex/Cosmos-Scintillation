import {documentStore, getDocument, setSaveState} from "../document/CosmosDocument.Controller";
import {getSettings} from "../settings/CosmosSettings.Controller";

let timer: number | undefined;
let savedRevision = 0;
let saving: Promise<void> | null = null;
let lastPath: string | null = null;

/** Writes the project now. Resolves when the file is on disk. */
export async function saveNow(): Promise<void> {
    window.clearTimeout(timer);
    while (saving) {
        await saving;
    }

    const {path, project, revision, saveState} = getDocument();
    if (!path || !project || (saveState === "saved" && revision === savedRevision)) {
        return;
    }

    setSaveState("saving");
    saving = (async () => {
        const result = await window.api.saveProject(path, project);
        const current = getDocument();

        if (!result.ok) {
            setSaveState("error", result.error ?? "The file could not be written.");
            return;
        }

        savedRevision = revision;
        // Changes made while the file was being written still need saving.
        setSaveState(current.revision === revision ? "saved" : "dirty");
    })();

    try {
        await saving;
    } finally {
        saving = null;
    }
}

/** Saves right away and waits for it. Used when leaving the project and when the window closes. */
export async function flushSave(): Promise<void> {
    await saveNow();
    if (getDocument().saveState === "dirty") {
        await saveNow();
    }
}

function schedule(): void {
    window.clearTimeout(timer);
    const {autosave, autosaveSeconds} = getSettings();
    if (!autosave) {
        return;
    }
    timer = window.setTimeout(() => void saveNow(), autosaveSeconds * 1000);
}

/** Watches the document: a new project resets the counters, every change restarts the autosave timer. */
export function startAutosave(): void {
    documentStore.subscribe(() => {
        const state = getDocument();
        if (state.path !== lastPath) {
            lastPath = state.path;
            savedRevision = state.revision;
            window.clearTimeout(timer);
            return;
        }
        if (state.saveState === "dirty" && state.revision !== savedRevision) {
            schedule();
        }
    });

    window.api.onFlushRequest(() => {
        void flushSave().finally(() => void window.api.flushDone());
    });
}
