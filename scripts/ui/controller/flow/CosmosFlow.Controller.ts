import type {ApiGraph, ApiNode, CosmosApi} from "../../../common/CommonInterface";
import type {PropValue} from "../../../common/projects/CosmosContract";
import {MAX_NODES_PER_API} from "../../../common/projects/CosmosConfig";
import {makeId} from "../../../common/utils/IdHelper";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {crudGraphFor} from "../../../common/utils/ProjectFactory";
import {requestConfirm} from "../confirm/CosmosConfirm.Controller";
import {getDocument, updateApi} from "../document/CosmosDocument.Controller";
import {getNodeDefinition} from "../registry/CosmosRegistry.Controller";
import {getSettings} from "../settings/CosmosSettings.Controller";
import {createStore, useStore} from "../store/CosmosStore.Controller";
import {showToast} from "../toast/CosmosToast.Controller";
import {
    arrangeGraph, checkConnection, cloneClip, compatiblePins, connect, createNode, orderEnds, removeNodes, snap, takeClip, type Clip, type Ends
} from "./CosmosGraph.Controller";

// =============================================================================================== //
// === The state of the editor that is not part of the project: view, selection, the wire in hand === //
// =============================================================================================== //

export interface FlowCamera {
    x: number;
    y: number;
    zoom: number;
}

export interface Wiring {
    fromNode: string;
    fromPin: string;
    direction: "in" | "out";
    /** Where the cursor is, in graph units. */
    x: number;
    y: number;
    /** The pinKey() of every pin the wire could end on. */
    targets: ReadonlySet<string>;
}

interface FlowState {
    apiId: string;
    camera: FlowCamera;
    selected: string[];
    wiring: Wiring | null;
    /** A pinKey() that refused a wire. The node shakes for a moment. */
    refused: string;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.8;
const EMPTY: FlowState = {apiId: "", camera: {x: 80, y: 80, zoom: 1}, selected: [], wiring: null, refused: ""};

const flowStore = createStore<FlowState>(EMPTY);
export const useFlow = () => useStore(flowStore);
export const getFlow = () => flowStore.get();

let clipboard: Clip | null = null;

const find = getNodeDefinition;
const apiOf = (apiId: string): CosmosApi | undefined => getDocument().project?.apis.find((item) => item.id === apiId);

/** Called when an API is opened or closed. The view starts fresh for every API. */
export function openFlow(apiId: string): void {
    flowStore.set({...EMPTY, apiId});
}

// === Camera === //

export const panBy = (dx: number, dy: number) => flowStore.set((state) => ({...state, camera: {...state.camera, x: state.camera.x + dx, y: state.camera.y + dy}}));

export function zoomAt(factor: number, screenX: number, screenY: number): void {
    flowStore.set((state) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.camera.zoom * factor));
        const ratio = zoom / state.camera.zoom;
        return {...state, camera: {zoom, x: screenX - (screenX - state.camera.x) * ratio, y: screenY - (screenY - state.camera.y) * ratio}};
    });
}

export const setCamera = (camera: FlowCamera) => flowStore.set((state) => ({...state, camera}));

/** Screen position inside the canvas -> graph units. */
export function toGraph(screenX: number, screenY: number): {x: number; y: number} {
    const {camera} = flowStore.get();
    return {x: (screenX - camera.x) / camera.zoom, y: (screenY - camera.y) / camera.zoom};
}

/** Shows the whole graph. */
export function fitGraph(graph: ApiGraph, width: number, height: number): void {
    if (graph.nodes.length === 0) {
        setCamera({x: 80, y: 80, zoom: 1});
        return;
    }
    const left = Math.min(...graph.nodes.map((node) => node.x));
    const top = Math.min(...graph.nodes.map((node) => node.y));
    const right = Math.max(...graph.nodes.map((node) => node.x + 240));
    const bottom = Math.max(...graph.nodes.map((node) => node.y + 160));
    const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min((width - 100) / (right - left), (height - 100) / (bottom - top))));
    setCamera({zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom});
}

// === Selection === //

export const select = (ids: string[]) => flowStore.set((state) => ({...state, selected: ids}));
export const clearSelection = () => select([]);

export function toggleSelect(id: string): void {
    flowStore.set((state) => ({...state, selected: state.selected.includes(id) ? state.selected.filter((item) => item !== id) : [...state.selected, id]}));
}

// === Changing the graph. The document controller keeps the history, so Undo works for all of it. === //

const change = (apiId: string, edit: (graph: ApiGraph) => ApiGraph, key = "") => updateApi(apiId, (api) => ({...api, graph: edit(api.graph)}), key);

export function addNodeAt(apiId: string, kind: string, x: number, y: number): string | null {
    const definition = find(kind);
    const api = apiOf(apiId);
    if (!definition || !api) {
        return null;
    }
    if (api.graph.nodes.length >= MAX_NODES_PER_API) {
        showToast(`An API can have ${MAX_NODES_PER_API} nodes at most.`, true);
        return null;
    }
    const {snapToGrid, gridSize} = getSettings();
    const node = createNode(definition, snap(x, gridSize, snapToGrid), snap(y, gridSize, snapToGrid));

    // A block that works on a table starts with the first table of the API's database, so it is ready to use.
    const database = getDocument().project?.databases.find((item) => item.id === api.databaseId);
    if (database && database.tables.length > 0 && definition.props.some((prop) => prop.type === "table") && !node.props.table) {
        node.props.table = database.tables[0].name;
    }

    change(apiId, (graph) => ({...graph, nodes: [...graph.nodes, node]}));
    select([node.id]);
    return node.id;
}

/**
 * Adds a "Find rows" block for a table and one "Get field" block for each column the user picked, wired together.
 * This is what picking data in the database view produces.
 */
export function addFieldReaders(apiId: string, tableName: string, columns: string[], x: number, y: number): void {
    const api = apiOf(apiId);
    const findNode = getNodeDefinition("dbFind");
    const reader = getNodeDefinition("getField");
    if (!api || !findNode || !reader || columns.length === 0) {
        return;
    }
    if (api.graph.nodes.length + 1 + columns.length > MAX_NODES_PER_API) {
        showToast(`An API can have ${MAX_NODES_PER_API} nodes at most.`, true);
        return;
    }

    const base = createNode(findNode, x, y);
    const source = {...base, props: {...base.props, table: tableName}};
    const nodes: ApiNode[] = [source];
    const links: ApiGraph["links"] = [];
    columns.forEach((name, index) => {
        const node = {...createNode(reader, x + 320, y + index * 110), props: {...createNode(reader, 0, 0).props, key: name}};
        nodes.push(node);
        links.push({id: makeId("lk"), from: {node: source.id, pin: "first"}, to: {node: node.id, pin: "object"}});
    });
    change(apiId, (graph) => ({nodes: [...graph.nodes, ...nodes], links: [...graph.links, ...links]}));
    select(nodes.map((node) => node.id));
    showToast(`Added ${columns.length} field${columns.length === 1 ? "" : "s"} of "${tableName}"`);
}

/** Adds the list, read, create, change and delete routes of one table below the blocks that are already there. */
export function addTableRoutes(apiId: string, tableName: string): void {
    const api = apiOf(apiId);
    const table = getDocument().project?.databases.find((item) => item.id === api?.databaseId)?.tables.find((item) => item.name === tableName);
    if (!api || !table) {
        return;
    }
    const top = api.graph.nodes.length === 0 ? 60 : Math.max(...api.graph.nodes.map((node) => node.y)) + 260;
    const added = crudGraphFor(table, top);
    if (api.graph.nodes.length + added.nodes.length > MAX_NODES_PER_API) {
        showToast(`An API can have ${MAX_NODES_PER_API} nodes at most.`, true);
        return;
    }
    change(apiId, (graph) => ({nodes: [...graph.nodes, ...added.nodes], links: [...graph.links, ...added.links]}));
    select(added.nodes.filter((node) => node.kind === "route").map((node) => node.id));
    showToast(`Added routes for "${table.name}"`);
}

/** Moves nodes once, when the drag ends. */
export function moveNodes(apiId: string, ids: ReadonlySet<string>, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) {
        return;
    }
    const {snapToGrid, gridSize} = getSettings();
    change(apiId, (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) => ids.has(node.id)
            ? {...node, x: snap(node.x + dx, gridSize, snapToGrid), y: snap(node.y + dy, gridSize, snapToGrid)}
            : node)
    }));
}

export function setProp(apiId: string, nodeId: string, key: string, value: PropValue): void {
    change(apiId, (graph) => ({...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? {...node, props: {...node.props, [key]: value}} : node)}), `prop-${nodeId}-${key}`);
}

export function removeLink(apiId: string, linkId: string): void {
    change(apiId, (graph) => ({...graph, links: graph.links.filter((link) => link.id !== linkId)}));
}

/** Deleting more than three nodes asks first. */
export const deleteSelected = exclusive(async (apiId: string): Promise<void> => {
    const ids = new Set(flowStore.get().selected);
    if (ids.size === 0) {
        return;
    }
    if (ids.size > 3) {
        const confirmed = await requestConfirm({
            title: `Delete ${ids.size} nodes?`,
            message: "Their wires are removed too. You can still bring them back with Undo.",
            confirmLabel: "Delete",
            danger: true
        });
        if (!confirmed) {
            return;
        }
    }
    change(apiId, (graph) => removeNodes(graph, ids));
    clearSelection();
});

export const clearGraph = exclusive(async (apiId: string): Promise<void> => {
    const api = apiOf(apiId);
    if (!api || api.graph.nodes.length === 0) {
        return;
    }
    const confirmed = await requestConfirm({
        title: "Remove every node?",
        message: `All ${api.graph.nodes.length} nodes and their wires are removed. You can still bring them back with Undo.`,
        confirmLabel: "Remove all",
        danger: true
    });
    if (confirmed) {
        change(apiId, () => ({nodes: [], links: []}));
        clearSelection();
    }
});

// === Copy, paste, duplicate === //

export function copySelected(apiId: string): void {
    const api = apiOf(apiId);
    const ids = new Set(flowStore.get().selected);
    if (api && ids.size > 0) {
        clipboard = takeClip(api.graph, ids);
    }
}

export function pasteClip(apiId: string, dx = 40, dy = 40): void {
    const api = apiOf(apiId);
    if (!api || !clipboard) {
        return;
    }
    if (api.graph.nodes.length + clipboard.nodes.length > MAX_NODES_PER_API) {
        showToast(`An API can have ${MAX_NODES_PER_API} nodes at most.`, true);
        return;
    }
    const copy = cloneClip(clipboard, dx, dy);
    change(apiId, (graph) => ({nodes: [...graph.nodes, ...copy.nodes], links: [...graph.links, ...copy.links]}));
    select(copy.nodes.map((node) => node.id));
}

export function duplicateSelected(apiId: string): void {
    copySelected(apiId);
    pasteClip(apiId);
}

// === Wires === //

/** Starts a wire from a pin. Every pin it could end on lights up. */
export function startWire(apiId: string, fromNode: string, fromPin: string, direction: "in" | "out", x: number, y: number): void {
    const api = apiOf(apiId);
    if (!api) {
        return;
    }
    flowStore.set((state) => ({
        ...state, wiring: {fromNode, fromPin, direction, x, y, targets: compatiblePins(api.graph, find, {node: fromNode, pin: fromPin})}
    }));
}

export const moveWire = (x: number, y: number) => flowStore.set((state) => state.wiring ? {...state, wiring: {...state.wiring, x, y}} : state);

/** Drops the wire on a pin, or on nothing. A wire that is refused shakes the node and says why. */
export function finishWire(apiId: string, target: {node: string; pin: string} | null): void {
    const wiring = flowStore.get().wiring;
    flowStore.set((state) => ({...state, wiring: null}));
    const api = apiOf(apiId);
    if (!wiring || !api || !target) {
        return;
    }

    const ends: Ends | null = orderEnds(api.graph, find, {node: wiring.fromNode, pin: wiring.fromPin}, target);
    if (!ends) {
        refuse(target.node, "Wires go from an output to an input");
        return;
    }
    const verdict = checkConnection(api.graph, find, ends);
    if (!verdict.ok) {
        refuse(target.node, verdict.reason);
        return;
    }
    change(apiId, (graph) => ({...graph, links: connect(graph, find, ends)}));
}

function refuse(nodeId: string, reason: string): void {
    showToast(reason, true);
    flowStore.set((state) => ({...state, refused: nodeId}));
    window.setTimeout(() => flowStore.set((state) => state.refused === nodeId ? {...state, refused: ""} : state), 500);
}

// === Tidy up === //

export function arrange(apiId: string): void {
    const api = apiOf(apiId);
    if (!api) {
        return;
    }
    const {gridSize} = getSettings();
    const positions = arrangeGraph(api.graph, find, gridSize);
    change(apiId, (graph) => ({...graph, nodes: graph.nodes.map((node: ApiNode) => positions.has(node.id) ? {...node, ...positions.get(node.id)!} : node)}));
}
