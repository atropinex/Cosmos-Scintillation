import {app, session} from "electron";
import {setFlagsFromString} from "v8";
import {ExtensionModel} from "../common/models/ExtensionModel";
import {KeybindModel} from "../common/models/KeybindModel";
import {LinkModel} from "../common/models/LinkModel";
import {ProjectModel} from "../common/models/ProjectModel";
import {RegistryModel} from "../common/models/RegistryModel";
import {RowStoreModel} from "../common/models/RowStoreModel";
import {SecretModel} from "../common/models/SecretModel";
import {ServiceModel} from "../common/models/ServiceModel";
import {SettingsModel} from "../common/models/SettingsModel";
import {SocketModel} from "../common/models/SocketModel";
import {ThemeModel} from "../common/models/ThemeModel";
import {MAIN_HEAP_MB, RENDERER_HEAP_MB} from "../common/projects/CosmosConfig";
import {CosmosIPC} from "../common/projects/CosmosConnection";
import {CosmosExportController} from "./../common/projects/controller/CosmosExportController";
import {CosmosExtensionController} from "../common/projects/controller/CosmosExtensionController";
import {CosmosLauncherController} from "../common/projects/controller/CosmosLauncherController";
import {CosmosLinkController} from "../common/projects/controller/CosmosLinkController";
import {CosmosProjectController} from "../common/projects/controller/CosmosProjectController";
import {CosmosRegistryController} from "../common/projects/controller/CosmosRegistryController";
import {CosmosTesterController} from "../common/projects/controller/CosmosTesterController";
import {CosmosRowsController} from "../common/projects/controller/CosmosRowsController";
import {CosmosSettingsController} from "../common/projects/controller/CosmosSettingsController";
import {CosmosWindowController} from "../common/projects/controller/CosmosWindowController";

// === Memory === //
// RAM is the scarce thing: cap the heap of the page (a renderer process) and of the main process.
// Both must be set before the app is ready.
app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${RENDERER_HEAP_MB}`);
setFlagsFromString(`--max-old-space-size=${MAIN_HEAP_MB}`);

// === Security === //

/** Nothing the page opens may leave the app: no new windows, no navigation, no webviews. */
function lockDownContents(): void {
    app.on("web-contents-created", (_event, contents) => {
        contents.setWindowOpenHandler(() => ({action: "deny"}));
        contents.on("will-navigate", (event) => event.preventDefault());
        contents.on("will-attach-webview", (event) => event.preventDefault());
    });
}

/** Every permission (camera, location, notifications, ...) is refused. */
function lockDownSession(): void {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
}

lockDownContents();

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    void app.whenReady().then(start);
}

async function start(): Promise<void> {
    lockDownSession();

    const windows = new CosmosWindowController();
    const settings = new SettingsModel();
    const secrets = new SecretModel();
    const extensions = new ExtensionModel(settings);
    const registry = new RegistryModel(extensions);
    const projects = new ProjectModel(settings);
    const links = new LinkModel(secrets);
    const sockets = new SocketModel(secrets, (event) => windows.send(CosmosIPC.socketEvent, event));
    const services = new ServiceModel(settings, () => registry.serviceSpecs(), (states) => windows.send(CosmosIPC.serviceChanged, states));

    new CosmosProjectController(windows, projects, registry).register();
    const rowStore = new RowStoreModel();
    new CosmosRowsController(projects, rowStore).register();
    new CosmosTesterController(projects, rowStore, registry).register();
    new CosmosRegistryController(registry).register();
    new CosmosExtensionController(windows, extensions, registry).register();
    new CosmosSettingsController(windows, settings, new ThemeModel(extensions), new KeybindModel()).register();
    new CosmosLinkController(windows, links, sockets).register();
    new CosmosLauncherController(windows, services).register();
    new CosmosExportController(windows, registry).register();

    windows.createWindow();
    void services.autoStart();

    app.on("second-instance", () => windows.show());
    app.on("activate", () => {
        if (!windows.window) {
            windows.createWindow();
        }
    });

    // Services are stopped before the app ends, so no program is left running in the background.
    let stopped = false;
    app.on("before-quit", (event) => {
        if (stopped) {
            return;
        }
        event.preventDefault();
        stopped = true;
        sockets.closeAll();
        void services.stopAll().finally(() => app.quit());
    });
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });
}
