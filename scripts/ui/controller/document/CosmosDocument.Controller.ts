import type {
    CosmosApi, CosmosDatabase, CosmosLink, CosmosProject, CosmosTable, ProjectFile
} from "../../../common/CommonInterface";
import type {SaveState} from "../../../common/projects/CosmosContract";
import {createStore, useStore, useStoreSelector} from "../store/CosmosStore.Controller";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 900;

export interface DocumentState {
    path: string | null;
    project: CosmosProject | null;
    /** Goes up with every change. The autosave compares it with the last saved one. */
    revision: number;
    saveState: SaveState;
    saveError: string;
    /** Older versions of the project. They share unchanged parts, so they cost little memory. */
    past: CosmosProject[];
    future: CosmosProject[];
}

const EMPTY: DocumentState = {
    path: null, project: null, revision: 0, saveState: "saved", saveError: "", past: [], future: []
};

export const documentStore = createStore<DocumentState>(EMPTY);
export const useDocument = () => useStore(documentStore);
export const getDocument = () => documentStore.get();
export const getProject = () => documentStore.get().project;
export const useProject = () => useStoreSelector(documentStore, (state) => state.project);

export const useDatabase = (id: string) => useStoreSelector(documentStore, (state) => state.project?.databases.find((item) => item.id === id));
export const useApi = (id: string) => useStoreSelector(documentStore, (state) => state.project?.apis.find((item) => item.id === id));
export const useLink = (id: string) => useStoreSelector(documentStore, (state) => state.project?.links.find((item) => item.id === id));
export const useCanUndo = () => useStoreSelector(documentStore, (state) => state.past.length > 0);
export const useCanRedo = () => useStoreSelector(documentStore, (state) => state.future.length > 0);

export function openDocument(file: ProjectFile): void {
    lastKey = "";
    documentStore.set({...EMPTY, path: file.path, project: file.project});
}

export function closeDocument(): void {
    lastKey = "";
    documentStore.set(EMPTY);
}

export function setSaveState(saveState: SaveState, saveError = ""): void {
    documentStore.set((state) => ({...state, saveState, saveError}));
}

let lastKey = "";
let lastTime = 0;

/**
 * The one way to change the project. `change` must return a new project and leave the old one alone
 * (spread, do not assign). Pass a `coalesceKey` for things that happen many times in a row, such as typing
 * or dragging, so they become one undo step.
 */
export function changeProject(change: (project: CosmosProject) => CosmosProject, coalesceKey = ""): void {
    documentStore.set((state) => {
        if (!state.project) {
            return state;
        }

        const next = change(state.project);
        if (next === state.project) {
            return state;
        }

        const now = Date.now();
        const merge = coalesceKey !== "" && coalesceKey === lastKey && now - lastTime < COALESCE_MS && state.past.length > 0;
        lastKey = coalesceKey;
        lastTime = now;

        return {
            ...state,
            project: next,
            revision: state.revision + 1,
            saveState: "dirty",
            past: merge ? state.past : [...state.past, state.project].slice(-HISTORY_LIMIT),
            future: []
        };
    });
}

export function undo(): void {
    lastKey = "";
    documentStore.set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous || !state.project) {
            return state;
        }
        return {
            ...state,
            project: previous,
            revision: state.revision + 1,
            saveState: "dirty",
            past: state.past.slice(0, -1),
            future: [state.project, ...state.future].slice(0, HISTORY_LIMIT)
        };
    });
}

export function redo(): void {
    lastKey = "";
    documentStore.set((state) => {
        const [following, ...rest] = state.future;
        if (!following || !state.project) {
            return state;
        }
        return {
            ...state,
            project: following,
            revision: state.revision + 1,
            saveState: "dirty",
            past: [...state.past, state.project].slice(-HISTORY_LIMIT),
            future: rest
        };
    });
}

// === Shortcuts for changing one part of the project === //

const replaceBy = <T extends {id: string}>(list: T[], id: string, change: (item: T) => T): T[] => {
    let changed = false;
    const next = list.map((item) => {
        if (item.id !== id) {
            return item;
        }
        const result = change(item);
        changed = changed || result !== item;
        return result;
    });
    return changed ? next : list;
};

export function updateDatabase(id: string, change: (database: CosmosDatabase) => CosmosDatabase, coalesceKey = ""): void {
    changeProject((project) => {
        const databases = replaceBy(project.databases, id, change);
        return databases === project.databases ? project : {...project, databases};
    }, coalesceKey);
}

export function updateTable(databaseId: string, tableId: string, change: (table: CosmosTable) => CosmosTable, coalesceKey = ""): void {
    updateDatabase(databaseId, (database) => {
        const tables = replaceBy(database.tables, tableId, change);
        return tables === database.tables ? database : {...database, tables};
    }, coalesceKey);
}

export function updateApi(id: string, change: (api: CosmosApi) => CosmosApi, coalesceKey = ""): void {
    changeProject((project) => {
        const apis = replaceBy(project.apis, id, change);
        return apis === project.apis ? project : {...project, apis};
    }, coalesceKey);
}

export function updateLink(id: string, change: (link: CosmosLink) => CosmosLink, coalesceKey = ""): void {
    changeProject((project) => {
        const links = replaceBy(project.links, id, change);
        return links === project.links ? project : {...project, links};
    }, coalesceKey);
}
