import type {CosmosDatabase, NodePropDefinition} from "../../../common/CommonInterface";
import type {PropValue} from "../../../common/projects/CosmosContract";
import styles from "./CosmosFlowProp.module.css";

interface CosmosFlowPropProps {
    prop: NodePropDefinition;
    value: PropValue | undefined;
    /** The node's other properties. A "column" property reads the "table" one. */
    props: Record<string, PropValue>;
    database: CosmosDatabase | undefined;
    onChange: (value: PropValue) => void;
}

/** One property of a node as a field. The node and the inspector use the same one. */
export default function CosmosFlowProp({prop, value, props, database, onChange}: CosmosFlowPropProps) {
    const current = value ?? prop.default;
    const stop = (event: {stopPropagation: () => void}) => event.stopPropagation();

    if (prop.type === "boolean") {
        return <input type="checkbox" className={styles.check} checked={current === true} onPointerDown={stop} onChange={(event) => onChange(event.target.checked)} aria-label={prop.label}/>;
    }
    if (prop.type === "number") {
        return <input type="number" className={styles.input} value={Number(current)} onPointerDown={stop} onChange={(event) => onChange(Number(event.target.value))} aria-label={prop.label}/>;
    }
    if (prop.type === "multiline") {
        return <textarea className={styles.input} rows={3} value={String(current)} onPointerDown={stop} onChange={(event) => onChange(event.target.value)} aria-label={prop.label}/>;
    }

    let options = prop.options;
    if (prop.type === "table") {
        options = (database?.tables ?? []).map((table) => ({value: table.name, label: table.name}));
    } else if (prop.type === "column") {
        const table = database?.tables.find((item) => item.name === String(props.table ?? "") || item.id === String(props.table ?? ""));
        options = (table?.columns ?? []).map((column) => ({value: column.name, label: column.name}));
        options = [{value: "", label: "(key column)"}, ...options];
    }

    if (prop.type === "select" || prop.type === "table" || prop.type === "column") {
        const list = options ?? [];
        return (
            <select className={styles.input} value={String(current)} onPointerDown={stop} onChange={(event) => onChange(event.target.value)} aria-label={prop.label}>
                {!list.some((option) => option.value === String(current)) && <option value={String(current)}>{String(current) || "(choose)"}</option>}
                {list.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        );
    }
    return <input className={styles.input} value={String(current)} maxLength={500} onPointerDown={stop} onChange={(event) => onChange(event.target.value)} aria-label={prop.label}/>;
}
