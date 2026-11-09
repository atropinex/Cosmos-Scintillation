/** Joins CSS class names, skipping anything that is false or empty: cx(styles.card, selected && styles.selected) */
export function cx(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(" ");
}
