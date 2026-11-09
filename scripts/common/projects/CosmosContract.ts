// === Plain types and constants shared by the main process, the preload script and the page === //

export type PropValue = string | number | boolean;

// === Projects === //

/** What a project is for. "both" gets one database and one API to start with. */
export const PROJECT_KINDS = ["database", "api", "both"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

// === Databases === //

/** The shape of the data an engine stores. The family decides which words the page uses. */
export const ENGINE_FAMILIES = ["relational", "document", "keyvalue"] as const;
export type EngineFamily = (typeof ENGINE_FAMILIES)[number];

/** The writers built into the app. An engine YAML file picks one with "exporter: sql". */
export const DB_EXPORTER_IDS = ["sql", "mongo", "redis"] as const;
export type DbExporterId = (typeof DB_EXPORTER_IDS)[number];

export const REFERENCE_ACTIONS = ["no action", "cascade", "restrict", "set null"] as const;
export type ReferenceAction = (typeof REFERENCE_ACTIONS)[number];

export const RELATION_KINDS = ["one-to-one", "many-to-one", "many-to-many"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

// === Links: the user's own APIs and sockets === //

export const LINK_KINDS = ["rest", "websocket"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_SOURCES = ["manual", "openapi", "asyncapi"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// === Visual scripting === //

/** What a language can generate, and what a node needs. */
export const CAPABILITIES = ["rest", "websocket"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type NodeCapability = Capability | "any";

export const PIN_DIRECTIONS = ["in", "out"] as const;
export type PinDirection = (typeof PIN_DIRECTIONS)[number];

/** "exec" pins carry the order of work, every other type carries a value. */
export const PIN_TYPES = ["exec", "any", "string", "number", "boolean", "list", "object"] as const;
export type PinType = (typeof PIN_TYPES)[number];

export const PROPERTY_TYPES = ["text", "multiline", "number", "boolean", "select", "table", "column"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

// === Launcher === //

export const SERVICE_KINDS = ["builtin-static", "process"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_CATEGORIES = ["Web", "Database", "Cache", "Other"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export type ServiceStatus = "stopped" | "starting" | "running" | "error";

// === Extensions === //

/** Extensions are data only: YAML files in these folders. They never run code inside the app. */
export const EXTENSION_KINDS = ["engines", "languages", "nodes", "services", "themes"] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

// === Themes === //

export const THEME_COLORS = ["background", "panel", "panelRaised", "text", "muted", "accent", "onAccent", "danger"] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

// === Saving === //

/** "dirty" = changed since the last save, "saving" = the file is being written right now. */
export type SaveState = "saved" | "dirty" | "saving" | "error";
