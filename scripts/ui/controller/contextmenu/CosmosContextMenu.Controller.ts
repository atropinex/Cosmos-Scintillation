import {createStore, useStore} from "../store/CosmosStore.Controller";

// === What a menu is made of === //
export interface MenuItem {
    label: string;
    onSelect?: () => void;
    items?: MenuEntry[]; // makes this item open a submenu
    checked?: boolean;
    disabled?: boolean;
    danger?: boolean;
    confirm?: boolean; // the first click asks "Click again to confirm"
    hint?: string; // small text on the right
}

export type MenuEntry = MenuItem | "separator";

interface MenuState {
    open: boolean;
    x: number;
    y: number;
    entries: MenuEntry[];
}

const menuStore = createStore<MenuState>({open: false, x: 0, y: 0, entries: []});
export const useContextMenu = () => useStore(menuStore);
export const isContextMenuOpen = () => menuStore.get().open;

export function openContextMenu(x: number, y: number, entries: MenuEntry[]): void {
    menuStore.set({open: true, x, y, entries});
}

export function closeContextMenu(): void {
    if (menuStore.get().open) {
        menuStore.set((state) => ({...state, open: false}));
    }
}

/** Opens the menu where the user right clicked. */
export function showMenuAtEvent(event: {preventDefault: () => void; clientX: number; clientY: number}, entries: MenuEntry[]): void {
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, entries);
}
