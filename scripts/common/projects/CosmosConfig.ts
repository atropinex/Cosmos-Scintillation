// === Window === //
export const WINDOW = {
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640
} as const;
export const WINDOW_BACKGROUND = "#0f1012";

/** If the page does not confirm that it saved, the window closes anyway after this long. */
export const FLUSH_TIMEOUT_MS = 2500;

// === Memory === //
// RAM is the scarce thing, so the heap is capped and everything big is read from disk on demand.
export const RENDERER_HEAP_MB = 192;
export const MAIN_HEAP_MB = 96;
/** Table rows are read from disk one page at a time. */
export const MAX_ROWS_PER_TABLE = 100000;
/** The tables whose rows the data store keeps in memory. */
export const ROW_CACHE_TABLES = 2;
/** Log lines kept per service. Older lines are dropped. */
export const MAX_LOG_LINES = 200;
export const MAX_LOG_LINE_LENGTH = 600;

// === Files === //
export const PROJECT_FILE = "project.cosmos.yaml";
export const PROJECT_FORMAT = "cosmos-scintillation";
export const PROJECT_VERSION = 1;
export const SCRIPT_FORMAT = "cosmos-script";
export const SCRIPT_VERSION = 1;
export const SCRIPT_EXTENSION = "cosmos-script.yaml";
export const DATA_FOLDER = "data";
export const PROJECTS_FOLDER_NAME = "Cosmos-Scintillation";
export const EXTENSION_FILE = "extension.yaml";
export const MAX_RECENT_PROJECTS = 24;

// === Defaults === //
export const DEFAULT_THEME_ID = "graphite";
export const DEFAULT_AUTOSAVE_SECONDS = 1.5;
export const DEFAULT_GRID_SIZE = 16;
export const DEFAULT_ROWS_PER_PAGE = 50;
export const DEFAULT_API_PORT = 8080;
export const DEFAULT_API_BASE_PATH = "/api";
export const DEFAULT_MAX_BODY_KB = 64;
export const DEFAULT_RATE_LIMIT = 120;

// === Limits that keep a broken or hostile file from freezing the app === //
export const MAX_DATABASES = 32;
export const MAX_TABLES_PER_DATABASE = 400;
export const MAX_COLUMNS_PER_TABLE = 200;
export const MAX_APIS = 64;
export const MAX_NODES_PER_API = 1500;
export const MAX_LINKS = 64;
export const MAX_ENDPOINTS_PER_LINK = 600;
export const MAX_COORDINATE = 100000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15000;

// === Local servers (the launcher) === //
/** Every server the app starts listens on this address only, never on the network. */
export const LOCAL_HOST = "127.0.0.1";
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

// === Guards against repeated actions === //
export const SHORT_COOLDOWN_MS = 1500;
