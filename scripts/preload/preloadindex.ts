import {contextBridge, ipcRenderer} from "electron";
import type {ElectronApi, ServiceState, SocketEvent} from "../common/CommonInterface";
import {CosmosIPC} from "../common/projects/CosmosConnection";

/** Subscribes to a message from the main process and returns the function that unsubscribes. */
function listen<T>(channel: string, callback: (value: T) => void): () => void {
    const listener = (_event: unknown, value: T) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

/** The only door between the page and the main process. */
const api: ElectronApi = {
    // Projects
    listRecents: () => ipcRenderer.invoke(CosmosIPC.listRecents),
    createProject: (name, kind, engineId) => ipcRenderer.invoke(CosmosIPC.createProject, name, kind, engineId),
    openProjectDialog: () => ipcRenderer.invoke(CosmosIPC.openProjectDialog),
    openProject: (path) => ipcRenderer.invoke(CosmosIPC.openProject, path),
    saveProject: (path, project) => ipcRenderer.invoke(CosmosIPC.saveProject, path, project),
    removeRecent: (path) => ipcRenderer.invoke(CosmosIPC.removeRecent, path),
    revealPath: (path) => ipcRenderer.invoke(CosmosIPC.revealPath, path),

    // Table data
    listRows: (projectPath, databaseId, tableId, offset, limit) => ipcRenderer.invoke(CosmosIPC.listRows, projectPath, databaseId, tableId, offset, limit),
    insertRow: (projectPath, database, tableId, values) => ipcRenderer.invoke(CosmosIPC.insertRow, projectPath, database, tableId, values),
    updateRow: (projectPath, database, tableId, rowId, values) => ipcRenderer.invoke(CosmosIPC.updateRow, projectPath, database, tableId, rowId, values),
    deleteRows: (projectPath, databaseId, tableId, rowIds) => ipcRenderer.invoke(CosmosIPC.deleteRows, projectPath, databaseId, tableId, rowIds),
    deleteTableData: (projectPath, databaseId, tableId) => ipcRenderer.invoke(CosmosIPC.deleteTableData, projectPath, databaseId, tableId),

    // Registries
    listRegistries: () => ipcRenderer.invoke(CosmosIPC.listRegistries),
    reloadRegistries: () => ipcRenderer.invoke(CosmosIPC.reloadRegistries),
    restoreRegistries: () => ipcRenderer.invoke(CosmosIPC.restoreRegistries),
    openRegistryFolder: () => ipcRenderer.invoke(CosmosIPC.openRegistryFolder),

    // Extensions
    listExtensions: () => ipcRenderer.invoke(CosmosIPC.listExtensions),
    setExtensionEnabled: (id, enabled) => ipcRenderer.invoke(CosmosIPC.setExtensionEnabled, id, enabled),
    installExtension: () => ipcRenderer.invoke(CosmosIPC.installExtension),
    removeExtension: (id) => ipcRenderer.invoke(CosmosIPC.removeExtension, id),
    openExtensionsFolder: () => ipcRenderer.invoke(CosmosIPC.openExtensionsFolder),

    // Settings, themes, keybinds
    getSettings: () => ipcRenderer.invoke(CosmosIPC.getSettings),
    patchSettings: (changes) => ipcRenderer.invoke(CosmosIPC.patchSettings, changes),
    listThemes: () => ipcRenderer.invoke(CosmosIPC.listThemes),
    openThemesFolder: () => ipcRenderer.invoke(CosmosIPC.openThemesFolder),
    listKeybinds: () => ipcRenderer.invoke(CosmosIPC.listKeybinds),
    setKeybind: (id, keys) => ipcRenderer.invoke(CosmosIPC.setKeybind, id, keys),
    resetKeybinds: () => ipcRenderer.invoke(CosmosIPC.resetKeybinds),
    openConfigFolder: () => ipcRenderer.invoke(CosmosIPC.openConfigFolder),
    getMemory: () => ipcRenderer.invoke(CosmosIPC.getMemory),

    // Export
    previewDatabaseExport: (database) => ipcRenderer.invoke(CosmosIPC.previewDatabaseExport, database),
    writeDatabaseExport: (database, projectName, lastFolder) => ipcRenderer.invoke(CosmosIPC.writeDatabaseExport, database, projectName, lastFolder),
    previewApiExport: (api, database, projectName) => ipcRenderer.invoke(CosmosIPC.previewApiExport, api, database, projectName),
    writeApiExport: (api, database, projectName, lastFolder) => ipcRenderer.invoke(CosmosIPC.writeApiExport, api, database, projectName, lastFolder),
    testApi: (projectPath, api, database, request) => ipcRenderer.invoke(CosmosIPC.testApi, projectPath, api, database, request),
    testSocket: (projectPath, api, database, request) => ipcRenderer.invoke(CosmosIPC.testSocket, projectPath, api, database, request),
    resetTestData: (projectPath) => ipcRenderer.invoke(CosmosIPC.resetTestData, projectPath),
    queryRows: (projectPath, database, query) => ipcRenderer.invoke(CosmosIPC.queryRows, projectPath, database, query),
    checkRow: (database, tableId, values) => ipcRenderer.invoke(CosmosIPC.checkRow, database, tableId, values),
    checkDatabase: (projectPath, database) => ipcRenderer.invoke(CosmosIPC.checkDatabase, projectPath, database),
    exportScript: (api) => ipcRenderer.invoke(CosmosIPC.exportScript, api),
    importScript: () => ipcRenderer.invoke(CosmosIPC.importScript),

    // Links
    importLink: () => ipcRenderer.invoke(CosmosIPC.importLink),
    encryptSecret: (plain) => ipcRenderer.invoke(CosmosIPC.encryptSecret, plain),
    sendRequest: (request) => ipcRenderer.invoke(CosmosIPC.sendRequest, request),
    socketOpen: (link) => ipcRenderer.invoke(CosmosIPC.socketOpen, link),
    socketSend: (linkId, text) => ipcRenderer.invoke(CosmosIPC.socketSend, linkId, text),
    socketClose: (linkId) => ipcRenderer.invoke(CosmosIPC.socketClose, linkId),
    onSocketEvent: (callback) => listen<SocketEvent>(CosmosIPC.socketEvent, callback),

    // Launcher
    listServices: () => ipcRenderer.invoke(CosmosIPC.listServices),
    startService: (id, confirmed) => ipcRenderer.invoke(CosmosIPC.startService, id, confirmed),
    stopService: (id) => ipcRenderer.invoke(CosmosIPC.stopService, id),
    patchService: (id, changes) => ipcRenderer.invoke(CosmosIPC.patchService, id, changes),
    pickServiceBinary: (id) => ipcRenderer.invoke(CosmosIPC.pickServiceBinary, id),
    pickServiceFolder: (id) => ipcRenderer.invoke(CosmosIPC.pickServiceFolder, id),
    getServiceLogs: (id) => ipcRenderer.invoke(CosmosIPC.getServiceLogs, id),
    onServiceChange: (callback) => listen<ServiceState[]>(CosmosIPC.serviceChanged, callback),

    // The window
    appReady: () => ipcRenderer.invoke(CosmosIPC.appReady),
    onFlushRequest: (callback) => listen<void>(CosmosIPC.flushRequest, () => callback()),
    flushDone: () => ipcRenderer.invoke(CosmosIPC.flushDone),
    quitApp: () => ipcRenderer.invoke(CosmosIPC.quitApp)
};

contextBridge.exposeInMainWorld("api", api);
