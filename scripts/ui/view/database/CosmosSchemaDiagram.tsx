import {useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent} from "react";
import type {CosmosDatabase, CosmosTable} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {listRelations} from "../../../common/utils/RelationHelper";
import {
    clearSchemaSelection, columnY, fitToTables, finishConnecting, getCamera, hoverTable, moveConnecting, moveTable, panBy,
    ROW_HEIGHT, selectInSchema, startConnecting, stopConnecting, TABLE_WIDTH, tableHeight, useCamera, useConnecting,
    useHoveredTable, useSchemaSelection, zoomAt, HEADER_HEIGHT
} from "../../controller/database/CosmosSchema.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosSchemaDiagram.module.css";

interface CosmosSchemaDiagramProps {
    database: CosmosDatabase;
}

/** Turns a screen position into a position on the diagram. */
function toDiagram(host: HTMLElement, clientX: number, clientY: number) {
    const rect = host.getBoundingClientRect();
    const camera = getCamera();
    return {x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom};
}

/**
 * The structure of a database, like the schema view of Supabase: a card for every table with its columns and
 * their types, and a line for every connection. Drag a card to move it, drag the empty space to pan, use the wheel
 * to zoom, and drag from the dot of a column onto another column to connect them.
 */
export default function CosmosSchemaDiagram({database}: CosmosSchemaDiagramProps) {
    const camera = useCamera();
    const selection = useSchemaSelection();
    const hovered = useHoveredTable();
    const connecting = useConnecting();
    const host = useRef<HTMLDivElement>(null);
    const relations = useMemo(() => listRelations(database), [database]);
    const tables = useMemo(() => new Map(database.tables.map((table) => [table.id, table])), [database]);

    // The wheel handler is added by hand, because React's wheel events can not be cancelled.
    useEffect(() => {
        const element = host.current;
        if (!element) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
        };
        element.addEventListener("wheel", onWheel, {passive: false});
        return () => element.removeEventListener("wheel", onWheel);
    }, []);

    useEffect(() => {
        const element = host.current;
        if (element) {
            fitToTables(database, element.clientWidth, element.clientHeight);
        }
        // Only when another database is shown, never while editing, so the view doesn't jump.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [database.id]);

    const onBackgroundDown = (event: ReactPointerEvent) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("[data-table]")) {
            return;
        }
        clearSchemaSelection();
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

    const onHeaderDown = (event: ReactPointerEvent, table: CosmosTable) => {
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        selectInSchema(table.id);
        const start = {x: event.clientX, y: event.clientY, tx: table.x, ty: table.y};
        const move = (e: PointerEvent) => {
            const zoom = getCamera().zoom;
            moveTable(database.id, table.id, Math.round((start.tx + (e.clientX - start.x) / zoom) / 8) * 8, Math.round((start.ty + (e.clientY - start.y) / zoom) / 8) * 8);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const onConnectDown = (event: ReactPointerEvent, table: CosmosTable, columnId: string) => {
        event.stopPropagation();
        event.preventDefault();
        const element = host.current;
        if (!element) {
            return;
        }
        const point = toDiagram(element, event.clientX, event.clientY);
        startConnecting({fromTableId: table.id, fromColumnId: columnId, ...point});

        const move = (e: PointerEvent) => {
            const p = toDiagram(element, e.clientX, e.clientY);
            moveConnecting(p.x, p.y);
        };
        const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-column]");
            if (target?.dataset.table && target.dataset.column) {
                finishConnecting(database.id, target.dataset.table, target.dataset.column);
            } else {
                stopConnecting();
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const lines = relations.map((relation) => {
        const from = tables.get(relation.fromTable);
        const to = tables.get(relation.toTable);
        if (!from || !to) {
            return null;
        }
        const toRight = to.x >= from.x;
        const x1 = toRight ? from.x + TABLE_WIDTH : from.x;
        const x2 = toRight ? to.x : to.x + TABLE_WIDTH;
        const y1 = columnY(from, relation.fromColumn);
        const y2 = columnY(to, relation.toColumn);
        const bend = Math.max(40, Math.abs(x2 - x1) / 2);
        const direction = toRight ? 1 : -1;
        const active = hovered === from.id || hovered === to.id || selection.tableId === from.id || selection.tableId === to.id;
        return {relation, x1, y1, x2, y2, bend, direction, active};
    });

    return (
        <div className={styles.host} ref={host} onPointerDown={onBackgroundDown}>
            <div className={styles.layer} style={{transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`}}>
                <svg className={styles.lines} width="1" height="1" style={{overflow: "visible"}}>
                    {lines.map((line) => line && (
                        <g key={`${line.relation.fromTable}-${line.relation.fromColumn}`} className={cx(styles.relation, line.active && styles.active)}>
                            <path d={`M ${line.x1} ${line.y1} C ${line.x1 + line.direction * line.bend} ${line.y1}, ${line.x2 - line.direction * line.bend} ${line.y2}, ${line.x2} ${line.y2}`}/>
                            {/* "Many" end: a crow's foot. "One" end: a bar. */}
                            {line.relation.kind === "one-to-one" ? (
                                <path d={`M ${line.x1} ${line.y1 - 6} V ${line.y1 + 6}`}/>
                            ) : (
                                <path d={`M ${line.x1 + line.direction * 10} ${line.y1} L ${line.x1} ${line.y1 - 6} M ${line.x1 + line.direction * 10} ${line.y1} L ${line.x1} ${line.y1 + 6}`}/>
                            )}
                            <path d={`M ${line.x2 - line.direction * 8} ${line.y2 - 6} V ${line.y2 + 6}`}/>
                            <text x={(line.x1 + line.x2) / 2} y={(line.y1 + line.y2) / 2 - 6} textAnchor="middle">{line.relation.label}</text>
                        </g>
                    ))}
                    {connecting && (() => {
                        const from = tables.get(connecting.fromTableId);
                        return from && (
                            <path
                                className={styles.ghost}
                                d={`M ${from.x + TABLE_WIDTH} ${columnY(from, connecting.fromColumnId)} L ${connecting.x} ${connecting.y}`}
                            />
                        );
                    })()}
                </svg>

                {database.tables.map((table) => (
                    <div
                        key={table.id}
                        data-table={table.id}
                        className={cx(styles.card, selection.tableId === table.id && styles.selected)}
                        style={{left: table.x, top: table.y, width: TABLE_WIDTH, height: tableHeight(table)}}
                        onPointerEnter={() => hoverTable(table.id)}
                        onPointerLeave={() => hoverTable("")}
                    >
                        <div className={styles.header} style={{height: HEADER_HEIGHT}} onPointerDown={(event) => onHeaderDown(event, table)}>
                            <CosmosIcon name="table" size={14}/>
                            <span className={styles.tableName}>{table.name}</span>
                            <span className={styles.count}>{table.columns.length}</span>
                        </div>
                        {table.columns.map((column) => (
                            <div
                                key={column.id}
                                data-table={table.id}
                                data-column={column.id}
                                className={cx(styles.row, selection.columnId === column.id && styles.rowSelected)}
                                style={{height: ROW_HEIGHT}}
                                onClick={() => selectInSchema(table.id, column.id)}
                            >
                                <span className={styles.keyIcon}>
                                    {column.primary ? <CosmosIcon name="key" size={12}/> : column.ref ? <CosmosIcon name="link" size={12}/> : null}
                                </span>
                                <span className={styles.columnName}>{column.name}</span>
                                {column.nullable && <span className={styles.flag} title="Can be empty">?</span>}
                                {column.unique && !column.primary && <span className={styles.flag} title="Unique">U</span>}
                                <span className={styles.type}>{column.type}</span>
                                <span
                                    className={styles.handle}
                                    title="Drag onto another column to connect"
                                    onPointerDown={(event) => onConnectDown(event, table, column.id)}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            <div className={styles.tools}>
                <button className={controls.iconBtn} aria-label="Zoom in" onClick={() => zoomAt(1.2, (host.current?.clientWidth ?? 0) / 2, (host.current?.clientHeight ?? 0) / 2)}>
                    <CosmosIcon name="plus" size={14}/>
                </button>
                <button className={controls.iconBtn} aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2, (host.current?.clientWidth ?? 0) / 2, (host.current?.clientHeight ?? 0) / 2)}>
                    <CosmosIcon name="minus" size={14}/>
                </button>
                <button
                    className={controls.iconBtn} aria-label="Fit to view" title="Show everything"
                    onClick={() => host.current && fitToTables(database, host.current.clientWidth, host.current.clientHeight)}
                >
                    <CosmosIcon name="fit" size={14}/>
                </button>
            </div>
        </div>
    );
}
