import type {CosmosDatabase, CosmosTable} from "../CommonInterface";
import type {RelationKind} from "../projects/CosmosContract";

export interface Relation {
    /** The column that holds the reference. */
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    kind: RelationKind;
    /** "N:1", "1:1" or "N:M", as shown on the line. */
    label: string;
    onDelete: string;
}

const LABELS: Record<RelationKind, string> = {"one-to-one": "1:1", "many-to-one": "N:1", "many-to-many": "N:M"};

/** A table that is only two or more references (and nothing else important) joins other tables. */
export function isJoinTable(table: CosmosTable): boolean {
    const references = table.columns.filter((column) => column.ref).length;
    return references >= 2 && table.columns.every((column) => column.ref || column.primary || column.name === "created_at");
}

/** Every foreign key of a database as a relation, with its kind worked out from the column. */
export function listRelations(database: CosmosDatabase): Relation[] {
    const relations: Relation[] = [];
    const tables = new Map(database.tables.map((table) => [table.id, table]));

    for (const table of database.tables) {
        const joins = isJoinTable(table);
        for (const column of table.columns) {
            if (!column.ref || !tables.get(column.ref.tableId)?.columns.some((item) => item.id === column.ref!.columnId)) {
                continue;
            }
            const kind: RelationKind = joins ? "many-to-many" : column.unique || column.primary ? "one-to-one" : "many-to-one";
            relations.push({
                fromTable: table.id,
                fromColumn: column.id,
                toTable: column.ref.tableId,
                toColumn: column.ref.columnId,
                kind,
                label: LABELS[kind],
                onDelete: column.ref.onDelete
            });
        }
    }
    return relations;
}
