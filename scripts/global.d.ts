import type {ElectronApi} from "./common/CommonInterface";

declare global {
    interface Window {
        /** Exposed by scripts/preload/preloadindex.ts. */
        api: ElectronApi;
    }
}

export {};
