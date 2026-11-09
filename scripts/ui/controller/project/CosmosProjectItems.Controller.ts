import type {CosmosApi, CosmosDatabase, CosmosLink} from "../../../common/CommonInterface";
import {createApi, createDatabase, createLink, type ApiPreset} from "../../../common/utils/ProjectFactory";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {makeId} from "../../../common/utils/IdHelper";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {changeProject, getDocument, getProject} from "../document/CosmosDocument.Controller";
import {getEngine, getRegistries} from "../registry/CosmosRegistry.Controller";
import {showToast} from "../toast/CosmosToast.Controller";
import {getSelection, select} from "../view/CosmosView.Controller";

/** The names must stay short and unique inside one project, so lists and exported files stay readable. */
function uniqueName(existing: string[], wanted: string): string {
    const base = wanted.trim().slice(0, 60) || "untitled";
    let name = base;
    let counter = 2;
    while (existing.includes(name)) {
        name = `${base}-${counter}`;
        counter++;
    }
    return name;
}

// === Databases === //

export function addDatabase(name: string, engineId: string): void {
    const engine = getEngine(engineId);
    const project = getProject();
    if (!engine || !project) {
        return;
    }

    const database = createDatabase(uniqueName(project.databases.map((item) => item.name), name), engine);
    changeProject((current) => ({...current, databases: [...current.databases, database]}));
    select("database", database.id);
}

export function renameDatabase(id: string, name: string): void {
    changeProject((project) => ({
        ...project,
        databases: project.databases.map((item) => item.id === id ? {...item, name: name.slice(0, 60)} : item)
    }), `rename-${id}`);
}

/** Deleting a database also deletes its rows on disk, and Undo cannot bring those back, so it asks twice as hard. */
export const deleteDatabase = exclusive(async (id: string): Promise<void> => {
    const {project, path} = getDocument();
    const database = project?.databases.find((item) => item.id === id);
    if (!project || !path || !database) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete database "${database.name}"?`,
        message: `This removes its ${database.tables.length} table(s) and all their data. The data can not be brought back with Undo.`,
        confirmLabel: "Delete database",
        danger: true,
        typeToConfirm: database.name
    });
    if (!confirmed) {
        return;
    }

    await window.api.deleteTableData(path, id, null);
    changeProject((current) => ({
        ...current,
        databases: current.databases.filter((item) => item.id !== id),
        // APIs that used it keep working as designs, they just have no database any more.
        apis: current.apis.map((api) => api.databaseId === id ? {...api, databaseId: ""} : api)
    }));
    if (getSelection().id === id) {
        select(null);
    }
    showToast(`Deleted "${database.name}"`);
}, (id) => id);

// === APIs === //

export function addApi(name: string, language: string, databaseId: string, preset: ApiPreset = "hello", tableId = ""): void {
    const project = getProject();
    if (!project) {
        return;
    }

    const table = project.databases.find((item) => item.id === databaseId)?.tables.find((item) => item.id === tableId);
    const api = createApi(uniqueName(project.apis.map((item) => item.name), name), language, databaseId, preset, table);
    changeProject((current) => ({...current, apis: [...current.apis, api]}));
    select("api", api.id);
}

export function renameApi(id: string, name: string): void {
    changeProject((project) => ({
        ...project,
        apis: project.apis.map((item) => item.id === id ? {...item, name: name.slice(0, 60)} : item)
    }), `rename-${id}`);
}

export const deleteApi = exclusive(async (id: string): Promise<void> => {
    const api = getProject()?.apis.find((item) => item.id === id);
    if (!api) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete API "${api.name}"?`,
        message: `Its ${api.graph.nodes.length} node(s) will be removed. Export the script first if you want to keep it. Undo can still bring it back until you close the project.`,
        confirmLabel: "Delete API",
        danger: true,
        typeToConfirm: api.name
    });
    if (!confirmed) {
        return;
    }

    changeProject((project) => ({...project, apis: project.apis.filter((item) => item.id !== id)}));
    if (getSelection().id === id) {
        select(null);
    }
    showToast(`Deleted "${api.name}"`);
}, (id) => id);

/** Adds an API from a .cosmos-script.yaml file, so scripts can move between projects and computers. */
export const importScript = exclusive(async (): Promise<void> => {
    const result = await window.api.importScript();
    if (result.cancelled) {
        return;
    }
    if (!result.ok || !result.api) {
        showToast(result.error ?? "That script could not be imported.", true);
        return;
    }

    const imported = result.api;
    const project = getProject();
    if (!project) {
        return;
    }

    const api = {...imported, name: uniqueName(project.apis.map((item) => item.name), imported.name)};
    changeProject((current) => ({...current, apis: [...current.apis, api]}));
    select("api", api.id);

    const missing = result.missingKinds.length > 0 ? ` Missing node kinds: ${result.missingKinds.join(", ")}. Install the extension that adds them.` : "";
    showToast(`Imported "${api.name}".${missing}`, result.missingKinds.length > 0);
});

/** The first language in the list that can write both REST and WebSocket, otherwise the first one. */
export function defaultLanguage(): string {
    const {languages} = getRegistries();
    return (languages.find((item) => item.capabilities.includes("websocket")) ?? languages[0])?.id ?? "";
}

// === Links (imported or hand written connections) === //

export function addLink(link: CosmosLink): void {
    const project = getProject();
    if (!project) {
        return;
    }

    const named = {...link, name: uniqueName(project.links.map((item) => item.name), link.name)};
    changeProject((current) => ({...current, links: [...current.links, named]}));
    select("link", named.id);
}

export function addEmptyLink(kind: CosmosLink["kind"]): void {
    addLink(createLink(kind === "websocket" ? "websocket" : "rest-api", kind, "manual", ""));
}

export const deleteLink = exclusive(async (id: string): Promise<void> => {
    const link = getProject()?.links.find((item) => item.id === id);
    if (!link) {
        return;
    }

    const confirmed = await requestConfirm({
        title: `Delete connection "${link.name}"?`,
        message: `Its ${link.endpoints.length} endpoint(s) will be removed from this project.`,
        confirmLabel: "Delete connection",
        danger: true
    });
    if (!confirmed) {
        return;
    }

    changeProject((project) => ({...project, links: project.links.filter((item) => item.id !== id)}));
    if (getSelection().id === id) {
        select(null);
    }
}, (id) => id);

/** Opens a file dialog and adds the OpenAPI or AsyncAPI description it holds. */
export const importLink = exclusive(async (): Promise<void> => {
    const result = await window.api.importLink();
    if (result.cancelled) {
        return;
    }
    if (!result.ok || !result.link) {
        showToast(result.error ?? "That file could not be imported.", true);
        return;
    }
    addLink(result.link);
    showToast(`Imported "${result.link.name}" with ${result.link.endpoints.length} endpoint(s)`);
});

// === Duplicating (added with the workspace view) === //

/** Copies the structure of a database. The rows are not copied, so the copy starts empty. */
export function duplicateDatabase(id: string): void {
    const project = getProject();
    const source = project?.databases.find((item) => item.id === id);
    if (!project || !source) {
        return;
    }

    // Every table and column gets a new id, and references are pointed at the new ids.
    const tableIds = new Map(source.tables.map((table) => [table.id, makeId("tb")]));
    const columnIds = new Map(source.tables.flatMap((table) => table.columns.map((column) => [column.id, makeId("cl")] as const)));
    const copy: CosmosDatabase = {
        ...source,
        id: makeId("db"),
        name: uniqueName(project.databases.map((item) => item.name), `${source.name}-copy`),
        tables: source.tables.map((table) => ({
            ...table,
            id: tableIds.get(table.id)!,
            columns: table.columns.map((column) => ({
                ...column,
                id: columnIds.get(column.id)!,
                ref: column.ref && tableIds.has(column.ref.tableId)
                    ? {...column.ref, tableId: tableIds.get(column.ref.tableId)!, columnId: columnIds.get(column.ref.columnId) ?? column.ref.columnId}
                    : null
            }))
        }))
    };
    changeProject((current) => ({...current, databases: [...current.databases, copy]}));
    select("database", copy.id);
    showToast(`Copied "${source.name}" without its data`);
}

export function duplicateApi(id: string): void {
    const project = getProject();
    const source = project?.apis.find((item) => item.id === id);
    if (!project || !source) {
        return;
    }

    const nodeIds = new Map(source.graph.nodes.map((node) => [node.id, makeId("n")]));
    const copy: CosmosApi = {
        ...source,
        id: makeId("ap"),
        name: uniqueName(project.apis.map((item) => item.name), `${source.name}-copy`),
        graph: {
            nodes: source.graph.nodes.map((node) => ({...node, id: nodeIds.get(node.id)!, props: {...node.props}})),
            links: source.graph.links.map((link) => ({
                id: makeId("lk"),
                from: {...link.from, node: nodeIds.get(link.from.node) ?? link.from.node},
                to: {...link.to, node: nodeIds.get(link.to.node) ?? link.to.node}
            }))
        }
    };
    changeProject((current) => ({...current, apis: [...current.apis, copy]}));
    select("api", copy.id);
}

export function duplicateLink(id: string): void {
    const source = getProject()?.links.find((item) => item.id === id);
    if (!source) {
        return;
    }
    addLink({
        ...source,
        id: makeId("lk"),
        name: `${source.name}-copy`,
        endpoints: source.endpoints.map((endpoint) => ({...endpoint, id: makeId("ep")})),
        headers: source.headers.map((header) => ({...header})),
        auth: {...source.auth}
    });
}

export function renameLink(id: string, name: string): void {
    changeProject((project) => ({
        ...project,
        links: project.links.map((item) => item.id === id ? {...item, name: name.slice(0, 60)} : item)
    }), `rename-${id}`);
}
