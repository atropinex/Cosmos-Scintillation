import {app, BrowserWindow, Menu} from "electron";
import {join} from "path";
import {FLUSH_TIMEOUT_MS, WINDOW, WINDOW_BACKGROUND} from "../CosmosConfig";
import {CosmosIPC} from "../CosmosConnection";

/**
 * Owns the app window. Closing it first asks the page to save everything, so no work is lost
 * even when the autosave timer has not fired yet.
 */
export class CosmosWindowController {
    window: BrowserWindow | null = null;

    private closing = false;
    private flushTimer: NodeJS.Timeout | undefined;

    createWindow(): void {
        // No default menu: its shortcuts (Ctrl+W, Ctrl+Z, ...) would fight with the app's own keybinds.
        if (process.platform !== "darwin") {
            Menu.setApplicationMenu(null);
        }

        const window = new BrowserWindow({
            ...WINDOW,
            backgroundColor: WINDOW_BACKGROUND,
            show: false,
            title: "Cosmos-Scintillation",
            webPreferences: {
                preload: join(__dirname, "../preload/preloadindex.js"),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                webSecurity: true,
                spellcheck: false
            }
        });

        window.on("close", (event: {preventDefault(): void}) => {
            if (this.closing) {
                return;
            }

            event.preventDefault();
            this.askPageToSave(window);
        });
        window.on("closed", () => {
            if (this.window === window) {
                this.window = null;
            }
        });

        this.window = window;
        this.loadPage(window);
    }

    /** While developing, electron-vite serves the page from a local dev server. */
    private loadPage(window: BrowserWindow): void {
        const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
        if (!app.isPackaged && devServerUrl) {
            void window.loadURL(devServerUrl);
        } else {
            void window.loadFile(join(__dirname, "../renderer/index.html"));
        }
    }

    /** Runs a native dialog on top of the app window. */
    withDialog<T>(show: (parent: BrowserWindow | undefined) => Promise<T>): Promise<T> {
        return show(this.window ?? undefined);
    }

    /** Sends a message to the page, if it is still there. */
    send(channel: string, payload: unknown): void {
        const contents = this.window?.webContents;
        if (contents && !contents.isDestroyed()) {
            contents.send(channel, payload);
        }
    }

    /** The page has drawn itself: show the window. */
    onRendererReady(): void {
        this.window?.show();
    }

    // === Saving before the window closes === //

    private askPageToSave(window: BrowserWindow): void {
        if (this.flushTimer) {
            return;
        }

        window.webContents.send(CosmosIPC.flushRequest);
        this.flushTimer = setTimeout(() => this.finishClosing(), FLUSH_TIMEOUT_MS);
    }

    /** The page says it has saved. */
    onFlushDone(): void {
        this.finishClosing();
    }

    private finishClosing(): void {
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
        this.closing = true;
        this.window?.close();
    }

    quit(): void {
        this.closing = false;
        this.window?.close();
    }

    show(): void {
        if (!this.window) {
            return;
        }
        if (this.window.isMinimized()) {
            this.window.restore();
        }
        this.window.focus();
    }
}
