/// <reference types="vite/client" />

/** Files imported with ?raw arrive as plain text. */
declare module "*?raw" {
    const content: string;
    export default content;
}
