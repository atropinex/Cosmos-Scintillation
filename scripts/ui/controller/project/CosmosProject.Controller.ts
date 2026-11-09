import type {ProjectFile, RecentProject} from "../../../common/CommonInterface";
import type {ProjectKind} from "../../../common/projects/CosmosContract";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {flushSave} from "../autosave/CosmosAutosave.Controller";
import {closeDocument, openDocument} from "../document/CosmosDocument.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";
import {select, setView} from "../view/CosmosView.Controller";

const recentStore = createStore<RecentProject[]>([]);
export const useRecents = () => useStore(recentStore);

export async function loadRecents(): Promise<void> {
    recentStore.set(await window.api.listRecents());
}

function enterWorkspace(file: ProjectFile): void {
    openDocument(file);
    const first = file.project.databases[0] ?? file.project.apis[0];
    select(first ? (file.project.databases[0] ? "database" : "api") : null, first?.id ?? "");
    setView("workspace");
}

export const createProject = exclusive(async (name: string, kind: ProjectKind, engine: string): Promise<void> => {
    const file = await window.api.createProject(name, kind, engine);
    if (!file) {
        showToast("Could not create the project.", true);
        return;
    }
    enterWorkspace(file);
});

export const openProjectDialog = exclusive(async (): Promise<void> => {
    const file = await window.api.openProjectDialog();
    if (file) {
        enterWorkspace(file);
    }
});

export const openRecent = exclusive(async (path: string): Promise<void> => {
    const file = await window.api.openProject(path);
    if (!file) {
        showToast("That project could not be opened. Its file may be missing or damaged.", true);
        await loadRecents();
        return;
    }
    enterWorkspace(file);
}, (path) => path);

export async function removeRecent(path: string): Promise<void> {
    await window.api.removeRecent(path);
    await loadRecents();
}

export const revealProject = (path: string) => window.api.revealPath(path);

/** Saves, closes the project and shows the project list again. */
export const goHome = exclusive(async (): Promise<void> => {
    await flushSave();
    closeDocument();
    select(null);
    setView("home");
    await loadRecents();
});
