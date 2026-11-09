/** Simple line icons on a 24 by 24 grid. Each value is an SVG path; "M" starts a new stroke. */
const ICONS = {
    home: "M3 11l9-8 9 8 M5 10v10h14V10",
    plus: "M12 5v14 M5 12h14",
    minus: "M5 12h14",
    close: "M6 6l12 12 M18 6L6 18",
    check: "M5 12l5 5 9-10",
    chevronRight: "M9 6l6 6-6 6",
    chevronDown: "M6 9l6 6 6-6",
    up: "M12 19V5 M6 11l6-6 6 6",
    down: "M12 5v14 M6 13l6 6 6-6",
    undo: "M9 14L4 9l5-5 M4 9h9a6 6 0 010 12h-3",
    redo: "M15 14l5-5-5-5 M20 9h-9a6 6 0 000 12h3",
    save: "M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6",
    export: "M12 15V3 M7 8l5-5 5 5 M5 14v6h14v-6",
    import: "M12 3v12 M7 10l5 5 5-5 M5 14v6h14v-6",
    settings: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4v6 M9 14v6",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
    copy: "M8 8h12v12H8z M16 8V4H4v12h4",
    edit: "M4 20h4L19 9l-4-4L4 16z M13 7l4 4",
    folder: "M3 6h6l2 2h10v11H3z",
    search: "M10 4a6 6 0 100 12 6 6 0 000-12z M15 15l5 5",
    refresh: "M20 11a8 8 0 10-2.3 5.7 M20 4v7h-7",
    fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
    play: "M7 4l13 8-13 8z",
    stop: "M6 6h12v12H6z",
    link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
    palette: "M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-6-4-11-8-11z",
    keyboard: "M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10",
    // Cosmos
    database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
    table: "M4 5h16v14H4z M4 10h16 M10 10v9",
    schema: "M4 4h6v5H4z M14 4h6v5h-6z M9 17h6v4H9z M7 9v4h10V9 M12 13v4",
    key: "M14 10a4 4 0 11-1-2.6L21 15v3h-3v-2h-2v-2h-2.3z",
    flow: "M4 5h6v5H4z M14 14h6v5h-6z M10 7.5h2a3 3 0 013 3V14",
    api: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M13.5 5l-3 14",
    socket: "M7 3v5 M17 3v5 M5 8h14v4a7 7 0 01-14 0z M12 19v2",
    server: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
    puzzle: "M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
    warning: "M12 4l9 16H3z M12 10v4 M12 17h.01",
    memory: "M4 8h16v8H4z M8 8v8 M12 8v8 M16 8v8 M7 5v3 M17 5v3",
    code: "M9 8l-4 4 4 4 M15 8l4 4-4 4",
    send: "M4 12l16-8-6 16-3-7z",
    plug: "M9 3v5 M15 3v5 M6 8h12v3a6 6 0 01-12 0z M12 17v4",
    box: "M4 6h16v12H4z",
    clock: "M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v4l3 2"
} as const;

export type IconName = keyof typeof ICONS;

interface CosmosIconProps {
    name: IconName;
    size?: number;
    filled?: boolean;
}

export default function CosmosIcon({name, size = 16, filled = false}: CosmosIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={ICONS[name]}/>
        </svg>
    );
}
