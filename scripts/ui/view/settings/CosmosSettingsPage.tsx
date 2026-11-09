import {useEffect, useState} from "react";
import type {KeybindAction} from "../../../common/CommonInterface";
import {cx} from "../../../common/utils/ClassHelper";
import {
    changeKeybind, closeSettings, loadKeybinds, patchSettings, refreshMemory, resetKeybinds, useKeybinds, useMemory, useSettings, useSettingsOpen
} from "../../controller/settings/CosmosSettings.Controller";
import {chooseTheme, openThemesFolder, reloadThemes, useThemes} from "../../controller/theme/CosmosTheme.Controller";
import CosmosModal from "../modal/CosmosModal";
import controls from "../shared/CosmosControls.module.css";
import {NumberField, Section, ToggleField} from "../shared/CosmosFields";
import styles from "./CosmosSettingsPage.module.css";

function KeybindRow({action}: {action: KeybindAction}) {
    const [text, setText] = useState(action.keys);
    useEffect(() => setText(action.keys), [action.keys]);
    return (
        <div className={styles.keyRow}>
            <span className={styles.keyLabel}>{action.label}</span>
            <input
                className={cx(controls.field, controls.mono, styles.keyInput)} value={text} maxLength={40} aria-label={action.label}
                onChange={(event) => setText(event.target.value)}
                onBlur={() => text !== action.keys && void changeKeybind(action.id, text)}
                onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            />
        </div>
    );
}

/** Settings in a dialog: look, saving, tables and a live view of the memory the app uses. */
export default function CosmosSettingsPage() {
    const open = useSettingsOpen();
    const settings = useSettings();
    const {list, themeId} = useThemes();
    const keybinds = useKeybinds();
    const memory = useMemory();

    // Memory is only measured while this dialog is open.
    useEffect(() => {
        if (!open) {
            return;
        }
        void loadKeybinds();
        void refreshMemory();
        const timer = window.setInterval(() => void refreshMemory(), 3000);
        return () => window.clearInterval(timer);
    }, [open]);

    return (
        <CosmosModal open={open} title="Settings" width={640} onClose={closeSettings}>
            <Section title="Theme">
                <div className={styles.themes}>
                    {list.themes.map((theme) => (
                        <button
                            key={theme.id} className={cx(styles.theme, themeId === theme.id && styles.picked)} onClick={() => void chooseTheme(theme.id)}
                            aria-pressed={themeId === theme.id}
                        >
                            <span className={styles.swatch} style={{background: theme.colors.background}}>
                                <i style={{background: theme.colors.panel}}/>
                                <i style={{background: theme.colors.accent}}/>
                                <i style={{background: theme.colors.text}}/>
                            </span>
                            <span>{theme.name}</span>
                        </button>
                    ))}
                </div>
                {list.problems.map((problem) => <p key={problem} className={styles.problem}>{problem}</p>)}
                <div className={styles.buttons}>
                    <button className={controls.btn} onClick={() => void reloadThemes()}>Reload themes</button>
                    <button className={controls.btn} onClick={() => void openThemesFolder()}>Open themes folder</button>
                </div>
            </Section>

            <Section title="Saving">
                <ToggleField label="Save automatically" value={settings.autosave} onChange={(autosave) => void patchSettings({autosave})}/>
                <NumberField
                    label="Wait before saving (seconds)" value={settings.autosaveSeconds} min={0.5} max={30} step={0.5}
                    onChange={(autosaveSeconds) => void patchSettings({autosaveSeconds})}
                />
            </Section>

            <Section title="Editing">
                <ToggleField label="Snap blocks and tables to the grid" value={settings.snapToGrid} onChange={(snapToGrid) => void patchSettings({snapToGrid})}/>
                <NumberField label="Grid size" value={settings.gridSize} min={4} max={64} step={4} onChange={(gridSize) => void patchSettings({gridSize})}/>
                <NumberField
                    label="Rows per page" value={settings.rowsPerPage} min={10} max={500} step={10}
                    hint="Smaller pages use less memory."
                    onChange={(rowsPerPage) => void patchSettings({rowsPerPage})}
                />
            </Section>

            <Section title="Memory" defaultOpen={false}>
                <p className={styles.total}>{memory.totalMb.toFixed(0)} MB in use</p>
                {memory.processes.map((item) => (
                    <div key={item.pid} className={styles.keyRow}>
                        <span className={styles.keyLabel}>{item.name}</span>
                        <span className={styles.muted}>{item.memoryMb.toFixed(0)} MB</span>
                    </div>
                ))}
            </Section>

            <Section title="Keyboard" defaultOpen={false}>
                {keybinds.actions.map((action) => <KeybindRow key={action.id} action={action}/>)}
                <div className={styles.buttons}>
                    <button className={controls.btn} onClick={() => void resetKeybinds()}>Reset keys</button>
                    <button className={controls.btn} onClick={() => void window.api.openConfigFolder()}>Open config folder</button>
                </div>
            </Section>
        </CosmosModal>
    );
}
