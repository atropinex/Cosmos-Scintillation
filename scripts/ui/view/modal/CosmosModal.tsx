import {useEffect, useState, type CSSProperties, type ReactNode} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import controls from "../shared/CosmosControls.module.css";
import CosmosIcon from "../shared/CosmosIcon";
import styles from "./CosmosModal.module.css";

const EXIT_MS = 260;

/**
 * Keeps something mounted for a moment after `open` turns false, so it can play its closing animation.
 * Returns whether to render, and whether to show the "open" look.
 */
export function useDelayedUnmount(open: boolean): {mounted: boolean; visible: boolean} {
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            const frame = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(frame);
        }

        setVisible(false);
        const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [open]);

    return {mounted, visible};
}

interface CosmosModalProps {
    open: boolean;
    title: string;
    width?: number;
    onClose: () => void;
    footer?: ReactNode;
    children: ReactNode;
}

/** A dialog that fades and rises in. Escape or a click on the backdrop closes it. */
export default function CosmosModal({open, title, width = 560, onClose, footer, children}: CosmosModalProps) {
    const {mounted, visible} = useDelayedUnmount(open);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [open, onClose]);

    if (!mounted) {
        return null;
    }

    return (
        <div
            className={cx(styles.backdrop, visible && styles.open)}
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={{"--dialog-width": `${width}px`} as CSSProperties}
            >
                <div className={styles.header}>
                    <h2 className={styles.title}>{title}</h2>
                    <button className={controls.iconBtn} aria-label="Close" onClick={onClose}>
                        <CosmosIcon name="close"/>
                    </button>
                </div>
                <div className={styles.body}>{children}</div>
                {footer && <div className={styles.footer}>{footer}</div>}
            </div>
        </div>
    );
}
