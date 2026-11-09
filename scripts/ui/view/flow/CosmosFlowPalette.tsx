import {useMemo, useState} from "react";
import type {CosmosDatabase, LanguageSummary} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {addNodeAt, toGraph} from "../../controller/flow/CosmosFlow.Controller";
import {categoryColor, paletteReason} from "../../controller/flow/CosmosGraph.Controller";
import {useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import CosmosFlowData from "./CosmosFlowData";
import styles from "./CosmosFlowPalette.module.css";

interface CosmosFlowPaletteProps {
    apiId: string;
    language: LanguageSummary | undefined;
    /** The API's database, shown in the Data tab. */
    database: CosmosDatabase | undefined;
    /** The size of the board, to put a double clicked block in the middle. */
    boardSize: () => {width: number; height: number};
}

/** The list of blocks. Drag one onto the board, or double click it to add it to the middle. */
export default function CosmosFlowPalette({apiId, language, database, boardSize}: CosmosFlowPaletteProps) {
    const {nodes} = useRegistries();
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<"blocks" | "data">("blocks");
    const [closed, setClosed] = useState<Set<string>>(new Set());

    const groups = useMemo(() => {
        const text = query.trim().toLowerCase();
        const map = new Map<string, typeof nodes>();
        for (const node of nodes) {
            if (text && !`${node.name} ${node.description} ${node.category}`.toLowerCase().includes(text)) {
                continue;
            }
            map.set(node.category, [...(map.get(node.category) ?? []), node]);
        }
        return [...map];
    }, [nodes, query]);

    const toggle = (category: string) => setClosed((current) => {
        const next = new Set(current);
        if (!next.delete(category)) {
            next.add(category);
        }
        return next;
    });

    const addToMiddle = (kind: string) => {
        const size = boardSize();
        const at = toGraph(size.width / 2, size.height / 2);
        addNodeAt(apiId, kind, at.x - 116, at.y - 40);
    };

    return (
        <aside className={styles.palette}>
            <div className={cx(controls.segmented, styles.tabs)} role="tablist">
                <button role="tab" aria-selected={tab === "blocks"} className={cx(controls.segment, tab === "blocks" && controls.selected)} onClick={() => setTab("blocks")}>Blocks</button>
                <button role="tab" aria-selected={tab === "data"} className={cx(controls.segment, tab === "data" && controls.selected)} onClick={() => setTab("data")}>Data</button>
            </div>
            {tab === "data" ? (
                <div className={styles.list}><CosmosFlowData apiId={apiId} database={database} boardSize={boardSize}/></div>
            ) : (
            <>
            <div className={styles.search}>
                <CosmosIcon name="search" size={14}/>
                <input value={query} placeholder="Search blocks" onChange={(event) => setQuery(event.target.value)} aria-label="Search blocks"/>
            </div>
            <div className={styles.list}>
                {groups.map(([category, items]) => (
                    <div key={category}>
                        <button className={styles.category} onClick={() => toggle(category)} aria-expanded={!closed.has(category) || !!query}>
                            <span className={styles.swatch} style={{background: categoryColor(category)}}/>
                            {category}
                            <CosmosIcon name={closed.has(category) && !query ? "chevronRight" : "chevronDown"} size={13}/>
                        </button>
                        {(!closed.has(category) || !!query) && items.map((node) => {
                            const reason = paletteReason(node, language);
                            return (
                                <div
                                    key={node.id} className={cx(styles.item, reason && styles.dim)} draggable title={reason || node.description}
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", `cosmos-node:${node.id}`);
                                        event.dataTransfer.effectAllowed = "copy";
                                    }}
                                    onDoubleClick={() => addToMiddle(node.id)}
                                >
                                    <span className={styles.name}>{node.name}</span>
                                    {reason && <span className={controls.tag}>{reason}</span>}
                                </div>
                            );
                        })}
                    </div>
                ))}
                {groups.length === 0 && <p className={styles.none}>No block matches.</p>}
            </div>
            </>
            )}
        </aside>
    );
}
