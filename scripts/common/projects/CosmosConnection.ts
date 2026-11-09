/** The names of the messages between the page and the main process. */
export const CosmosIPC = {
    // Projects
    listRecents: "projects:list-recents",
    createProject: "projects:create",
    openProjectDialog: "projects:open-dialog",
    openProject: "projects:open",
    saveProject: "projects:save",
    removeRecent: "projects:remove-recent",
    revealPath: "projects:reveal",

    // Table data (rows are stored next to the project, one file per table)
    listRows: "rows:list",
    insertRow: "rows:insert",
    updateRow: "rows:update",
    deleteRows: "rows:delete",
    deleteTableData: "rows:delete-table-data",

    // Tester
    testApi: "tester:api",
    testSocket: "tester:socket",
    resetTestData: "tester:reset",
    queryRows: "tester:query-rows",
    checkRow: "tester:check-row",
    checkDatabase: "tester:check-database",

    // Engines, languages, nodes and services: YAML files that extensions can add to
    listRegistries: "registry:list",
    reloadRegistries: "registry:reload",
    restoreRegistries: "registry:restore-defaults",
    openRegistryFolder: "registry:open-folder",

    // Extensions
    listExtensions: "extensions:list",
    setExtensionEnabled: "extensions:set-enabled",
    installExtension: "extensions:install",
    removeExtension: "extensions:remove",
    openExtensionsFolder: "extensions:open-folder",

    // Settings, themes, keybinds
    getSettings: "settings:get",
    patchSettings: "settings:patch",
    listThemes: "themes:list",
    openThemesFolder: "themes:open-folder",
    listKeybinds: "keybinds:list",
    setKeybind: "keybinds:set",
    resetKeybinds: "keybinds:reset",
    openConfigFolder: "config:open-folder",
    getMemory: "app:memory",

    // Export
    previewDatabaseExport: "export:db-preview",
    writeDatabaseExport: "export:db-write",
    previewApiExport: "export:api-preview",
    writeApiExport: "export:api-write",
    exportScript: "script:export",
    importScript: "script:import",

    // Links: the user's own APIs and sockets
    importLink: "links:import",
    encryptSecret: "links:encrypt-secret",
    sendRequest: "links:send-request",
    socketOpen: "links:socket-open",
    socketSend: "links:socket-send",
    socketClose: "links:socket-close",
    socketEvent: "links:socket-event", // main -> page

    // Launcher (the local services, like XAMPP)
    listServices: "launcher:list",
    startService: "launcher:start",
    stopService: "launcher:stop",
    patchService: "launcher:patch",
    pickServiceBinary: "launcher:pick-binary",
    pickServiceFolder: "launcher:pick-folder",
    getServiceLogs: "launcher:logs",
    serviceChanged: "launcher:changed", // main -> page

    // The window
    appReady: "app:ready",
    flushRequest: "app:flush-request", // sent from main to the page: save everything now
    flushDone: "app:flush-done",
    quitApp: "app:quit"
} as const;
