import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from "react";
import type {CosmosApi, CosmosDatabase, NodeDefinition, PinDefinition} from "../../../common/CommonInterface";
import type {PropValue} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {showMenuAtEvent, type MenuEntry} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import {
    addNodeAt, clearSelection, copySelected, deleteSelected, duplicateSelected, fitGraph, finishWire, moveNodes, moveWire, panBy, pasteClip,
    removeLink, select, setProp, startWire, toGraph, toggleSelect, useFlow, zoomAt, getFlow
} from "../../controller/flow/CosmosFlow.Controller";
import {NODE_WIDTH, nodeHeight, PIN_COLORS, pinAnchor, pinKey, validateNode, wirePath} from "../../controller/flow/CosmosGraph.Controller";
import {getLanguage, useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import CosmosFlowNode from "./CosmosFlowNode";
import styles from "./CosmosFlowCanvas.module.css";

const CULL_AFTER = 80; // with more nodes than this, nodes far outside the screen are not drawn
const NO_PINS: ReadonlySet<string> = new Set();

interface CosmosFlowCanvasProps {
    api: CosmosApi;
    database: CosmosDatabase | undefined;
}

/**
 * The drawing board. Drag the empty space to move around, use the wheel to zoom, drag a block by its header, and drag
 * from a dot to another dot to connect them. Double click a wire to remove it. Right click to add a block.
 */
export default function CosmosFlowCanvas({api, database}: CosmosFlowCanvasProps) {
    const {camera, selected, wiring, refused} = useFlow();
    const {nodes: definitions} = useRegistries();
    const host = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({width: 1000, height: 700});
    const [drag, setDrag] = useState<{dx: number; dy: number} | null>(null);
    const frame = useRef(0);

    const definitionOf = useMemo(() => new Map(definitions.map((item) => [item.id, item])), [definitions]);
    const language = getLanguage(api.language);
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const nodeById = useMemo(() => new Map(api.graph.nodes.map((node) => [node.id, node])), [api.graph.nodes]);

    const connectedByNode = useMemo(() => {
        const result = new Map<string, Set<string>>();
        for (const link of api.graph.links) {
            const set = result.get(link.to.node) ?? new Set<string>();
            set.add(pinKey(link.to.node, link.to.pin, "in"));
            result.set(link.to.node, set);
        }
        return result;
    }, [api.graph.links]);

    // === Size, wheel, first view === //

    useEffect(() => {
        const element = host.current;
        if (!element) {
            return;
        }
        const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
        };
        element.addEventListener("wheel", onWheel, {passive: false});
        fitGraph(api.graph, element.clientWidth, element.clientHeight);
        return () => {
            observer.disconnect();
            element.removeEventListener("wheel", onWheel);
        };
        // The first view is set once per API.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.id]);

    const local = (clientX: number, clientY: number) => {
        const rect = host.current?.getBoundingClientRect();
        return {x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0)};
    };

    // === Dragging nodes. The moving nodes only shift on screen, the project changes once when they are dropped. === //

    const onHeaderDown = useCallback((event: ReactPointerEvent, nodeId: string) => {
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        const current = getFlow().selected;
        let ids = current;
        if (event.shiftKey || event.ctrlKey) {
            toggleSelect(nodeId);
            return;
        }
        if (!current.includes(nodeId)) {
            ids = [nodeId];
            select(ids);
        }

        const start = {x: event.clientX, y: event.clientY};
        const zoom = getFlow().camera.zoom;
        let delta = {dx: 0, dy: 0};
        const move = (e: PointerEvent) => {
            delta = {dx: (e.clientX - start.x) / zoom, dy: (e.clientY - start.y) / zoom};
            cancelAnimationFrame(frame.current);
            frame.current = requestAnimationFrame(() => setDrag(delta));
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            cancelAnimationFrame(frame.current);
            setDrag(null);
            moveNodes(api.id, new Set(ids), delta.dx, delta.dy);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [api.id]);

    // === Wires in hand === //

    const onPinDown = useCallback((event: ReactPointerEvent, nodeId: string, pin: PinDefinition) => {
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        const point = toGraph(local(event.clientX, event.clientY).x, local(event.clientX, event.clientY).y);
        startWire(api.id, nodeId, pin.id, pin.direction, point.x, point.y);

        const move = (e: PointerEvent) => {
            const p = local(e.clientX, e.clientY);
            const g = toGraph(p.x, p.y);
            moveWire(g.x, g.y);
        };
        const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-pin]");
            const [node, , pinId] = hit?.dataset.pin?.split("|") ?? [];
            finishWire(api.id, node && pinId ? {node, pin: pinId} : null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.id]);

    const onProp = useCallback((nodeId: string, key: string, value: PropValue) => setProp(api.id, nodeId, key, value), [api.id]);

    // === Background: pan, menu, drop, keys === //

    const onBackgroundDown = (event: ReactPointerEvent) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("[data-node]")) {
            return;
        }
        host.current?.focus();
        clearSelection();
        let last = {x: event.clientX, y: event.clientY};
        const move = (e: PointerEvent) => {
            panBy(e.clientX - last.x, e.clientY - last.y);
            last = {x: e.clientX, y: e.clientY};
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const onContextMenu = (event: React.MouseEvent) => {
        const p = local(event.clientX, event.clientY);
        const at = toGraph(p.x, p.y);
        const categories = new Map<string, MenuEntry[]>();
        for (const definition of definitions) {
            const list = categories.get(definition.category) ?? [];
            list.push({label: definition.name, onSelect: () => addNodeAt(api.id, definition.id, at.x, at.y)});
            categories.set(definition.category, list);
        }
        const entries: MenuEntry[] = [...categories].map(([label, items]) => ({label, items}));
        entries.push("separator", {label: "Paste", onSelect: () => pasteClip(api.id)});
        showMenuAtEvent(event, entries);
    };

    const onDrop = (event: React.DragEvent) => {
        const text = event.dataTransfer.getData("text/plain");
        if (!text.startsWith("cosmos-node:")) {
            return;
        }
        event.preventDefault();
        const p = local(event.clientX, event.clientY);
        const at = toGraph(p.x, p.y);
        addNodeAt(api.id, text.slice("cosmos-node:".length), at.x - NODE_WIDTH / 2, at.y - 15);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if ((event.target as HTMLElement).closest("input, textarea, select")) {
            return;
        }
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (key === "delete" || key === "backspace") {
            event.preventDefault();
            void deleteSelected(api.id);
        } else if (mod && key === "c") {
            copySelected(api.id);
        } else if (mod && key === "v") {
            pasteClip(api.id);
        } else if (mod && key === "d") {
            event.preventDefault();
            duplicateSelected(api.id);
        } else if (mod && key === "a") {
            event.preventDefault();
            select(api.graph.nodes.map((node) => node.id));
        } else if (key === "escape") {
            clearSelection();
        }
    };

    // === What is drawn === //

    const offset = (id: string) => (drag && selectedSet.has(id) ? drag : null);
    const view = {
        left: -camera.x / camera.zoom - 200, top: -camera.y / camera.zoom - 200,
        right: (size.width - camera.x) / camera.zoom + 200, bottom: (size.height - camera.y) / camera.zoom + 200
    };
    const cull = api.graph.nodes.length > CULL_AFTER;
    const shown = cull
        ? api.graph.nodes.filter((node) => node.x + NODE_WIDTH > view.left && node.x < view.right && node.y + nodeHeight(definitionOf.get(node.kind)) > view.top && node.y < view.bottom)
        : api.graph.nodes;

    const anchorOf = (nodeId: string, pinId: string, direction: "in" | "out") => {
        const node = nodeById.get(nodeId);
        if (!node) {
            return null;
        }
        const shift = offset(nodeId);
        return pinAnchor({x: node.x + (shift?.dx ?? 0), y: node.y + (shift?.dy ?? 0)}, definitionOf.get(node.kind), pinId, direction);
    };
    const pinTypeOf = (definition: NodeDefinition | undefined, pinId: string) => definition?.pins.find((pin) => pin.id === pinId)?.type ?? "any";

    const wires = api.graph.links.map((link) => {
        const from = anchorOf(link.from.node, link.from.pin, "out");
        const to = anchorOf(link.to.node, link.to.pin, "in");
        if (!from || !to) {
            return null;
        }
        const type = pinTypeOf(definitionOf.get(nodeById.get(link.from.node)?.kind ?? ""), link.from.pin);
        const active = selectedSet.has(link.from.node) || selectedSet.has(link.to.node);
        return {link, d: wirePath(from, to), type, active};
    });

    let ghost: string | null = null;
    if (wiring) {
        const anchor = anchorOf(wiring.fromNode, wiring.fromPin, wiring.direction);
        if (anchor) {
            ghost = wiring.direction === "out" ? wirePath(anchor, {x: wiring.x, y: wiring.y}) : wirePath({x: wiring.x, y: wiring.y}, anchor);
        }
    }

    return (
        <div
            ref={host} className={styles.host} tabIndex={0}
            onPointerDown={onBackgroundDown} onContextMenu={onContextMenu} onKeyDown={onKeyDown}
            onDragOver={(event) => event.preventDefault()} onDrop={onDrop}
            style={{backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`}}
        >
            <div className={styles.layer} style={{transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`}}>
                <svg className={styles.wires} width="1" height="1" style={{overflow: "visible"}}>
                    {wires.map((wire) => wire && (
                        <g key={wire.link.id}>
                            <path
                                className={cx(styles.wire, wire.type === "exec" && styles.exec, wire.active && styles.active)}
                                d={wire.d} stroke={PIN_COLORS[wire.type]}
                            />
                            <path className={styles.hit} d={wire.d} onDoubleClick={() => removeLink(api.id, wire.link.id)}>
                                <title>Double click to remove</title>
                            </path>
                        </g>
                    ))}
                    {ghost && <path className={styles.ghost} d={ghost}/>}
                </svg>

                {shown.map((node) => {
                    const definition = definitionOf.get(node.kind);
                    const shift = offset(node.id);
                    return (
                        <CosmosFlowNode
                            key={node.id} node={node} definition={definition} database={database}
                            selected={selectedSet.has(node.id)} refused={refused === node.id}
                            connected={connectedByNode.get(node.id) ?? NO_PINS}
                            targets={wiring ? wiring.targets : null}
                            hints={validateNode(node, definition, language)}
                            offsetX={shift?.dx ?? 0} offsetY={shift?.dy ?? 0}
                            onHeaderDown={onHeaderDown} onPinDown={onPinDown} onProp={onProp}
                        />
                    );
                })}
            </div>

            {api.graph.nodes.length === 0 && (
                <div className={styles.hint}>
                    <b>Start here</b>
                    <span>Drag a block from the list on the left, or right click on this board.</span>
                </div>
            )}
        </div>
    );
}
