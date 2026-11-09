import {useState} from "react";
import type {EngineDefinition} from "../../../common/CommonInterface";
import {PROJECT_KINDS, type ProjectKind} from "../../../common/projects/CosmosContract";
import {cx} from "../../../common/utils/ClassHelper";
import {createProject} from "../../controller/project/CosmosProject.Controller";
import {useRegistries} from "../../controller/registry/CosmosRegistry.Controller";
import CosmosModal from "../modal/CosmosModal";
import controls from "../shared/CosmosControls.module.css";
import styles from "./CosmosNewProject.module.css";

const KIND_LABELS: Record<ProjectKind, string> = {database: "Database", api: "API", both: "Both"};
const KIND_TEXT: Record<ProjectKind, string> = {
    database: "Design tables and keep data.",
    api: "Build an API with blocks.",
    both: "A database and an API that uses it."
};
const FAMILY_LABELS: Record<EngineDefinition["family"], string> = {relational: "Tables", document: "Documents", keyvalue: "Keys and values"};

interface NewProjectProps {
    open: boolean;
    onClose: () => void;
}

/** Asks for a name, what the project is for, and which database engine to start with. */
export default function CosmosNewProject({open, onClose}: NewProjectProps) {
    const {engines} = useRegistries();
    const [name, setName] = useState("");
    const [kind, setKind] = useState<ProjectKind>("both");
    const [engineId, setEngineId] = useState("");

    const chosen = engines.find((item) => item.id === engineId) ?? engines.find((item) => item.id === "postgresql") ?? engines[0];
    const needsEngine = kind !== "api";
    const ready = name.trim() !== "" && (!needsEngine || Boolean(chosen));

    const create = () => {
        if (!ready) {
            return;
        }
        void createProject(name.trim(), kind, chosen?.id ?? "");
        onClose();
    };

    return (
        <CosmosModal
            open={open}
            title="New project"
            width={640}
            onClose={onClose}
            footer={
                <>
                    <button className={controls.btn} onClick={onClose}>Cancel</button>
                    <button className={cx(controls.btn, controls.btnPrimary)} disabled={!ready} onClick={create}>Create</button>
                </>
            }
        >
            <div className={styles.form}>
                <label className={styles.block}>
                    <span className={controls.label}>Name</span>
                    <input
                        className={controls.field}
                        value={name}
                        autoFocus
                        placeholder="My shop"
                        maxLength={60}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && create()}
                    />
                </label>

                <div className={styles.block}>
                    <span className={controls.label}>What do you want to make?</span>
                    <div className={styles.kinds}>
                        {PROJECT_KINDS.map((item) => (
                            <button key={item} className={cx(styles.kind, kind === item && styles.selected)} onClick={() => setKind(item)}>
                                <b>{KIND_LABELS[item]}</b>
                                <span>{KIND_TEXT[item]}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {needsEngine && (
                    <div className={styles.block}>
                        <span className={controls.label}>Database engine</span>
                        <div className={styles.engines}>
                            {engines.map((engine) => (
                                <button
                                    key={engine.id}
                                    className={cx(styles.engine, chosen?.id === engine.id && styles.selected)}
                                    onClick={() => setEngineId(engine.id)}
                                >
                                    <span className={styles.engineHead}>
                                        <b>{engine.name}</b>
                                        <span className={cx(controls.tag, controls.tagAccent)}>{FAMILY_LABELS[engine.family]}</span>
                                    </span>
                                    <span className={styles.engineText}>{engine.description}</span>
                                </button>
                            ))}
                        </div>
                        {engines.length === 0 && <p className={controls.hint}>No engines found. Open Extensions to install one, or restore the built-in files in Settings.</p>}
                    </div>
                )}
            </div>
        </CosmosModal>
    );
}
