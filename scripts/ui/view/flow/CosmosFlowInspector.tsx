import type {ApiNode, CosmosDatabase, LanguageSummary} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {deleteSelected, setProp} from "../../controller/flow/CosmosFlow.Controller";
import {categoryColor, validateNode} from "../../controller/flow/CosmosGraph.Controller";
import {getNodeDefinition} from "../../controller/registry/CosmosRegistry.Controller";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import CosmosFlowProp from "./CosmosFlowProp";
import styles from "./CosmosFlowInspector.module.css";

interface CosmosFlowInspectorProps {
    apiId: string;
    node: ApiNode | undefined;
    selectedCount: number;
    database: CosmosDatabase | undefined;
    language: LanguageSummary | undefined;
}

/** The details of the chosen block: what it does, its settings, and what is wrong with it. */
export default function CosmosFlowInspector({apiId, node, selectedCount, database, language}: CosmosFlowInspectorProps) {
    if (!node || selectedCount !== 1) {
        return (
            <aside className={styles.panel}>
                <p className={styles.empty}>{selectedCount > 1 ? `${selectedCount} blocks chosen.` : "Choose a block to see its settings."}</p>
                {selectedCount > 1 && (
                    <button className={cx(controls.btn, controls.btnDanger)} onClick={() => void deleteSelected(apiId)}><CosmosIcon name="trash" size={14}/> Delete {selectedCount} blocks</button>
                )}
            </aside>
        );
    }

    const definition = getNodeDefinition(node.kind);
    const hints = validateNode(node, definition, language);

    return (
        <aside className={styles.panel} key={node.id}>
            <div className={styles.head}>
                <span className={styles.swatch} style={{background: categoryColor(definition?.category ?? "unknown")}}/>
                <h3 className={styles.title}>{definition?.name ?? node.kind}</h3>
            </div>
            {definition?.description && <p className={styles.desc}>{definition.description}</p>}
            {hints.map((hint) => <p key={hint} className={styles.hint}><CosmosIcon name="warning" size={13}/> {hint}</p>)}

            {definition?.props.map((prop) => (
                <label key={prop.key} className={styles.field}>
                    <span>{prop.label}</span>
                    <CosmosFlowProp prop={prop} value={node.props[prop.key]} props={node.props} database={database} onChange={(value) => setProp(apiId, node.id, prop.key, value)}/>
                    {prop.hint && <small>{prop.hint}</small>}
                </label>
            ))}
            {definition?.props.length === 0 && <p className={styles.empty}>This block has no settings. Connect its pins.</p>}

            <button className={cx(controls.btn, controls.btnDanger, styles.delete)} onClick={() => void deleteSelected(apiId)}>
                <CosmosIcon name="trash" size={14}/> Delete block
            </button>
        </aside>
    );
}
