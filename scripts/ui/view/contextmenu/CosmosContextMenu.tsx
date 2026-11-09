import {useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {
    closeContextMenu, useContextMenu, type MenuEntry, type MenuItem
} from "../../controller/contextmenu/CosmosContextMenu.Controller";
import styles from "./CosmosContextMenu.module.css";

/** The right-click menu. Closes when you click elsewhere, scroll, resize, or leave the window. */
export default function CosmosContextMenu() {
    const menu = useContextMenu();

    useEffect(() => {
        if (!menu.open) {
            return;
        }

        const closeIfOutside = (event: Event) => {
            if (!(event.target as HTMLElement).closest("[data-context-menu]")) {
                closeContextMenu();
            }
        };
        document.addEventListener("pointerdown", closeIfOutside, true);
        document.addEventListener("scroll", closeContextMenu, true);
        window.addEventListener("resize", closeContextMenu);
        window.addEventListener("blur", closeContextMenu);

        return () => {
            document.removeEventListener("pointerdown", closeIfOutside, true);
            document.removeEventListener("scroll", closeContextMenu, true);
            window.removeEventListener("resize", closeContextMenu);
            window.removeEventListener("blur", closeContextMenu);
        };
    }, [menu.open]);

    if (!menu.open) {
        return null;
    }

    // The key restarts the menu when it is opened again at another spot.
    return <MenuList key={`${menu.x}:${menu.y}`} entries={menu.entries} x={menu.x} y={menu.y}/>;
}

// === A list of entries (the root menu or a submenu) === //

interface MenuListProps {
    entries: MenuEntry[];
    x?: number;
    y?: number;
    isSub?: boolean;
    focusFirst?: boolean; // a submenu opened with the keyboard takes focus
    goBack?: () => void; // closes a submenu and returns to its parent item
}

function MenuList({entries, x = 0, y = 0, isSub = false, focusFirst = false, goBack}: MenuListProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(false);

    // Keep the menu inside the window.
    useLayoutEffect(() => {
        const menu = ref.current!;
        const rect = menu.getBoundingClientRect();

        if (!isSub) {
            menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
            menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
            return;
        }

        // A submenu opens to the right of its parent, or to the left when there isn't room.
        if (rect.right > window.innerWidth - 8) {
            menu.style.left = "auto";
            menu.style.right = "calc(100% + 4px)";
            menu.style.transformOrigin = "top right";
        }
        if (rect.bottom > window.innerHeight - 8) {
            menu.style.top = `${-6 - (rect.bottom - window.innerHeight + 8)}px`;
        }
    }, [isSub, x, y]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setShown(true)); // lets the open animation play
        return () => cancelAnimationFrame(frame);
    }, []);

    // The root menu takes focus so the arrow keys work, and gives it back when it closes.
    useEffect(() => {
        const menu = ref.current!;
        if (focusFirst) {
            menu.querySelector<HTMLElement>("[data-menu-item]:not(:disabled)")?.focus();
            return;
        }
        if (isSub) {
            return;
        }

        const previous = document.activeElement;
        menu.focus({preventScroll: true});
        return () => {
            if (previous instanceof HTMLElement && previous.isConnected) {
                previous.focus({preventScroll: true});
            }
        };
    }, [isSub, focusFirst]);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const menu = ref.current!;
        const items = Array.from(menu.querySelectorAll<HTMLElement>(":scope > [data-menu-row] > [data-menu-item]:not(:disabled)"));
        const current = items.indexOf(document.activeElement as HTMLElement);
        const focusAt = (index: number) => items[(index + items.length) % items.length]?.focus();

        switch (event.key) {
            case "ArrowDown":
                focusAt(current + 1);
                break;
            case "ArrowUp":
                focusAt(current < 0 ? -1 : current - 1);
                break;
            case "Home":
                focusAt(0);
                break;
            case "End":
                focusAt(-1);
                break;
            case "ArrowRight": {
                const active = document.activeElement as HTMLElement | null;
                if (active?.hasAttribute("aria-haspopup")) {
                    active.click(); // opens the submenu
                }
                break;
            }
            case "ArrowLeft":
                if (!goBack) {
                    return;
                }
                goBack();
                break;
            case "Escape":
            case "Tab":
                closeContextMenu();
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    return (
        <div
            ref={ref}
            className={cx(styles.menu, isSub ? styles.submenu : styles.root, shown && styles.open)}
            role="menu"
            tabIndex={-1}
            data-context-menu
            onKeyDown={onKeyDown}
        >
            {entries.map((entry, index) => {
                if (entry === "separator") {
                    return <div key={index} className={styles.menuSep} role="separator"/>;
                }
                return <MenuRow key={`${index}:${entry.label}`} entry={entry}/>;
            })}
        </div>
    );
}

// === One item === //

function MenuRow({entry}: {entry: MenuItem}) {
    const itemRef = useRef<HTMLButtonElement>(null);
    const timer = useRef<number | undefined>(undefined);
    const [submenuOpen, setSubmenuOpen] = useState(false);
    const [focusSubmenu, setFocusSubmenu] = useState(false);
    const [armed, setArmed] = useState(false); // "confirm" items ask for a second click

    useEffect(() => {
        if (!armed) {
            return;
        }
        const reset = window.setTimeout(() => setArmed(false), 3000);
        return () => window.clearTimeout(reset);
    }, [armed]);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const onClick = () => {
        if (entry.items) {
            setFocusSubmenu(true);
            setSubmenuOpen(true);
            return;
        }
        if (entry.confirm && !armed) {
            setArmed(true);
            return;
        }
        closeContextMenu();
        entry.onSelect?.();
    };

    // Hovering opens a submenu after a short pause; leaving the row (and its submenu) closes it.
    const hoverIn = () => {
        if (!entry.items) {
            return;
        }
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            setFocusSubmenu(false);
            setSubmenuOpen(true);
        }, 120);
    };
    const hoverOut = () => {
        if (!entry.items) {
            return;
        }
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSubmenuOpen(false), 200);
    };

    return (
        <div className={styles.menuRow} data-menu-row onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
            <button
                ref={itemRef}
                className={cx(styles.menuItem, entry.danger && styles.danger)}
                role="menuitem"
                data-menu-item
                disabled={entry.disabled}
                aria-haspopup={entry.items ? "menu" : undefined}
                onClick={onClick}
            >
                <span className={styles.menuCheck}>{entry.checked ? "✓" : ""}</span>
                <span>{armed ? "Click again to confirm" : entry.label}</span>
                {entry.items ? <span className={styles.menuArrow}/> : <span className={styles.menuHint}>{entry.hint ?? ""}</span>}
            </button>

            {submenuOpen && entry.items && (
                <MenuList
                    isSub
                    entries={entry.items}
                    focusFirst={focusSubmenu}
                    goBack={() => {
                        setSubmenuOpen(false);
                        itemRef.current?.focus();
                    }}
                />
            )}
        </div>
    );
}
