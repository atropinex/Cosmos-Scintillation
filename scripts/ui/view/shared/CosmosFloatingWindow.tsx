import {useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";
import controls from "./CosmosControls.module.css";
import CosmosIcon from "./CosmosIcon";
import styles from "./CosmosFloatingWindow.module.css";

interface Frame {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Where each window was last left, so it opens in the same place and size again. Lives only while the app runs. */
const remembered = new Map<string, Frame>();

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

interface CosmosFloatingWindowProps {
    /** Windows with the same id share a remembered place. */
    id: string;
    title: string;
    onClose: () => void;
    children: ReactNode;
}

/** A small window above the page. Drag its title to move it, drag its corner to resize it. */
export default function CosmosFloatingWindow({id, title, onClose, children}: CosmosFloatingWindowProps) {
    const [frame, setFrame] = useState<Frame>(() => remembered.get(id) ?? {
        width: 460,
        height: 340,
        x: Math.max(16, window.innerWidth - 500),
        y: Math.max(16, window.innerHeight - 400)
    });
    const box = useRef<HTMLDivElement>(null);
    const drag = useRef<{dx: number; dy: number} | null>(null);

    const place = (next: Frame) => {
        // Always keep the title bar reachable.
        const clamped = {
            ...next,
            x: Math.min(Math.max(0, next.x), Math.max(0, window.innerWidth - 120)),
            y: Math.min(Math.max(0, next.y), Math.max(0, window.innerHeight - 40))
        };
        remembered.set(id, clamped);
        setFrame(clamped);
    };

    // Resizing with the corner changes the box itself, so its size is read back when the pointer is released.
    const saveSize = () => {
        const rect = box.current?.getBoundingClientRect();
        if (rect) {
            place({...frame, width: Math.max(MIN_WIDTH, Math.round(rect.width)), height: Math.max(MIN_HEIGHT, Math.round(rect.height))});
        }
    };

    return createPortal(
        <div
            ref={box} className={styles.window} role="dialog" aria-label={title}
            style={{left: frame.x, top: frame.y, width: frame.width, height: frame.height}}
            onPointerUp={saveSize}
        >
            <div
                className={styles.title}
                onPointerDown={(event: {clientX: number; clientY: number; currentTarget: HTMLElement; pointerId: number; target: EventTarget}) => {
                    if ((event.target as HTMLElement).closest("button")) {
                        return;
                    }
                    drag.current = {dx: event.clientX - frame.x, dy: event.clientY - frame.y};
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event: {clientX: number; clientY: number}) => {
                    if (drag.current) {
                        place({...frame, x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy});
                    }
                }}
                onPointerUp={() => {
                    drag.current = null;
                }}
            >
                <b>{title}</b>
                <button className={controls.iconBtn} aria-label="Close the window" onClick={onClose}><CosmosIcon name="close" size={14}/></button>
            </div>
            <div className={styles.content}>{children}</div>
        </div>,
        document.body
    );
}
