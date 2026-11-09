import {lazy, Suspense, useEffect, useState} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {announceReady} from "../../controller/app/CosmosApp.Controller";
import {saveNow} from "../../controller/autosave/CosmosAutosave.Controller";
import {redo, undo, useDocument} from "../../controller/document/CosmosDocument.Controller";
import {openSettings, useSettingsOpen} from "../../controller/settings/CosmosSettings.Controller";
import {setView, useView, type AppView} from "../../controller/view/CosmosView.Controller";
import CosmosHome from "../home/CosmosHome";
import CosmosIcon, {type IconName} from "../shared/CosmosIcon";
import styles from "./CosmosApp.module.css";

// Big views load the first time they are opened, so the app starts light and stays light.
const CosmosWorkspace = lazy(() => import("../workspace/CosmosWorkspace"));
const CosmosLauncher = lazy(() => import("../launcher/CosmosLauncher"));
const CosmosExtensions = lazy(() => import("../extensions/CosmosExtensions"));
const CosmosSettingsPage = lazy(() => import("../settings/CosmosSettingsPage"));

// === The slim bar on the left === //

interface RailButtonProps {
    icon: IconName;
    label: string;
    active?: boolean;
    onClick: () => void;
}

function RailButton({icon, label, active, onClick}: RailButtonProps) {
    return (
        <button className={cx(styles.railButton, active && styles.active)} aria-label={label} title={label} onClick={onClick}>
            <CosmosIcon name={icon} size={20}/>
            <span className={styles.railLabel}>{label}</span>
        </button>
    );
}

/** The window: a rail on the left and the current view on the right. */
export default function CosmosApp() {
    const view = useView();
    const {project} = useDocument();
    const settingsOpen = useSettingsOpen();
    const [settingsSeen, setSettingsSeen] = useState(false);

    useEffect(() => announceReady(), []);
    useEffect(() => {
        if (settingsOpen) {
            setSettingsSeen(true);
        }
    }, [settingsOpen]);

    // Ctrl+S saves now, Ctrl+Z and Ctrl+Y step through changes (but not while typing in a field).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }
            const key = event.key.toLowerCase();
            const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select") !== null;

            if (key === "s") {
                event.preventDefault();
                void saveNow();
            } else if (!typing && key === "z") {
                event.preventDefault();
                if (event.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            } else if (!typing && key === "y") {
                event.preventDefault();
                redo();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const go = (next: AppView) => () => setView(next);
    const shown: AppView = view === "workspace" && !project ? "home" : view;

    return (
        <div className={styles.app}>
            <nav className={styles.rail} aria-label="Main">
                <span className={styles.mark} aria-hidden="true"/>
                <RailButton icon="home" label="Projects" active={shown === "home"} onClick={go("home")}/>
                {project && (
                    <RailButton icon="database" label="Project" active={shown === "workspace"} onClick={go("workspace")}/>
                )}
                <RailButton icon="server" label="Launcher" active={shown === "launcher"} onClick={go("launcher")}/>
                <RailButton icon="puzzle" label="Extensions" active={shown === "extensions"} onClick={go("extensions")}/>
                <span className={styles.grow}/>
                <RailButton icon="settings" label="Settings" active={settingsOpen} onClick={openSettings}/>
            </nav>

            {/* The key restarts the entrance animation each time the view changes. */}
            <main className={styles.stage} key={shown}>
                <Suspense fallback={null}>
                    {shown === "home" && <CosmosHome/>}
                    {shown === "workspace" && <CosmosWorkspace/>}
                    {shown === "launcher" && <CosmosLauncher/>}
                    {shown === "extensions" && <CosmosExtensions/>}
                </Suspense>
            </main>

            {(settingsOpen || settingsSeen) && (
                <Suspense fallback={null}>
                    <CosmosSettingsPage/>
                </Suspense>
            )}
        </div>
    );
}
