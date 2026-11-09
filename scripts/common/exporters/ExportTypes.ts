/** One file an exporter wants written. `path` is relative to the folder the user chose. */
export interface GeneratedFile {
    path: string;
    content: string;
}

/** What a script or code writer returns. Nothing is written to disk by the writer itself. */
export interface GeneratedOutput {
    files: GeneratedFile[];
    /** Things the user should know, for example "Redis has no foreign keys, references were written as comments". */
    notes: string[];
}
