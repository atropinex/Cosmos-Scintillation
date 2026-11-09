import {getDocument} from "../document/CosmosDocument.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";

export type AppView = "home" | "workspace" | "launcher" | "extensions";

const viewStore = createStore<AppView>("home");
export const useView = () => useStore(viewStore);
export const getView = () => viewStore.get();
export const setView = (view: AppView) => viewStore.set(view);

/** Leaves the launcher or the extensions page: back to the open project, or to the project list. */
export const goBack = () => setView(getDocument().project ? "workspace" : "home");

// === What is open inside a project === //

export type WorkspaceSection = "database" | "api" | "link";

export interface WorkspaceSelection {
    section: WorkspaceSection | null;
    id: string;
}

const selectionStore = createStore<WorkspaceSelection>({section: null, id: ""});
export const useSelection = () => useStore(selectionStore);
export const getSelection = () => selectionStore.get();
export const select = (section: WorkspaceSection | null, id = "") => selectionStore.set({section, id});
