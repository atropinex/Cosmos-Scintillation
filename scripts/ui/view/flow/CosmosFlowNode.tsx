import {memo, type PointerEvent as ReactPointerEvent} from "react";
import type {ApiNode, CosmosDatabase, NodeDefinition, PinDefinition} from "../../../common/CommonInterface";
import type {PropValue} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {
    categoryColor, MAX_INLINE_PROPS, NODE_HEADER, NODE_PAD, NODE_WIDTH, PIN_COLORS, PIN_ROW, pinKey, PROP_ROW, splitPins
} from "../../controller/flow/CosmosGraph.Controller";
import CosmosFlowProp from "./CosmosFlowProp";
import styles from "./CosmosFlowNode.module.css";

interface CosmosFlowNodeProps {
    node: ApiNode;
    definition: NodeDefinition | undefined;
    database: CosmosDatabase | undefined;
    selected: boolean;
    refused: boolean;
    /** pinKey() of every input pin that has a wire. */
    connected: ReadonlySet<string>;
    /** pinKey() of the pins a wire in hand could land on, or null when nobody is wiring. */
    targets: ReadonlySet<string> | null;
    hints: string[];
    offsetX: number;
    offsetY: number;
    onHeaderDown: (event: ReactPointerEvent, nodeId: string) => void;
    onPinDown: (event: ReactPointerEvent, nodeId: string, pin: PinDefinition) => void;
    onProp: (nodeId: string, key: string, value: PropValue) => void;
}

/** One block of the script: a coloured header, pins on both sides and a few fields. */
function CosmosFlowNode({node, definition, database, selected, refused, connected, targets, hints, offsetX, offsetY, onHeaderDown, onPinDown, onProp}: CosmosFlowNodeProps) {
    const {inputs, outputs} = splitPins(definition);
    const rows = Math.max(inputs.length, outputs.length, 1);
    const inline = definition?.props.slice(0, MAX_INLINE_PROPS) ?? [];

    const renderPin = (pin: PinDefinition) => {
        const key = pinKey(node.id, pin.id, pin.direction);
        const dimmed = targets !== null && !targets.has(key);
        const lit = targets !== null && targets.has(key);
        const isInput = pin.direction === "in";
        const editable = isInput && !connected.has(key) && (pin.type === "string" || pin.type === "number" || pin.type === "boolean");
        const value = node.props[`pin_${pin.id}`] ?? pin.default;

        return (
            <div key={key} className={cx(styles.pin, isInput ? styles.in : styles.out, dimmed && styles.dim, lit && styles.lit)} style={{height: PIN_ROW}}>
                <span
                    className={cx(styles.dot, pin.type === "exec" && styles.exec, connected.has(key) && styles.filled)}
                    style={{"--pin": PIN_COLORS[pin.type]} as React.CSSProperties}
                    data-pin={`${node.id}|${pin.direction}|${pin.id}`}
                    onPointerDown={(event) => onPinDown(event, node.id, pin)}
                />
                <span className={styles.pinName}>{pin.name}</span>
                {editable && (
                    pin.type === "boolean" ? (
                        <input type="checkbox" checked={value === true} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onProp(node.id, `pin_${pin.id}`, event.target.checked)}/>
                    ) : (
                        <input
                            className={styles.pinInput} type={pin.type === "number" ? "number" : "text"} value={value === undefined ? "" : String(value)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) => onProp(node.id, `pin_${pin.id}`, pin.type === "number" ? Number(event.target.value) : event.target.value)}
                        />
                    )
                )}
            </div>
        );
    };

    return (
        <div
            className={cx(styles.node, selected && styles.selected, refused && styles.shake, hints.length > 0 && styles.warned)}
            style={{
                left: node.x, top: node.y, width: NODE_WIDTH,
                transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
                "--cat": categoryColor(definition?.category ?? "unknown")
            } as React.CSSProperties}
            data-node={node.id}
            title={hints.join("\n") || definition?.description}
        >
            <div className={styles.header} style={{height: NODE_HEADER}} onPointerDown={(event) => onHeaderDown(event, node.id)}>
                <span className={styles.title}>{definition?.name ?? node.kind}</span>
                {hints.length > 0 && <span className={styles.warn}>!</span>}
            </div>
            <div className={styles.pins} style={{padding: `${NODE_PAD}px 0`, minHeight: rows * PIN_ROW + NODE_PAD * 2}}>
                <div className={styles.column}>{inputs.map(renderPin)}</div>
                <div className={styles.column}>{outputs.map(renderPin)}</div>
            </div>
            {inline.map((prop) => (
                <div key={prop.key} className={styles.prop} style={{height: PROP_ROW}}>
                    <span className={styles.propLabel}>{prop.label}</span>
                    <CosmosFlowProp prop={prop} value={node.props[prop.key]} props={node.props} database={database} onChange={(value) => onProp(node.id, prop.key, value)}/>
                </div>
            ))}
        </div>
    );
}

export default memo(CosmosFlowNode);
