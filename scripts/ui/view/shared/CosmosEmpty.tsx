import {cx} from "../../../common/utils/ClassHelper";
import controls from "./CosmosControls.module.css";
import CosmosIcon, {type IconName} from "./CosmosIcon";
import styles from "./CosmosEmpty.module.css";

interface EmptyStateProps {
    icon: IconName;
    title: string;
    text?: string;
    action?: {label: string; onClick: () => void};
}

/** What a panel shows when there is nothing in it yet. */
export function EmptyState({icon, title, text, action}: EmptyStateProps) {
    return (
        <div className={styles.empty}>
            <span className={styles.icon}><CosmosIcon name={icon} size={24}/></span>
            <h3 className={styles.title}>{title}</h3>
            {text && <p className={styles.text}>{text}</p>}
            {action && (
                <button className={cx(controls.btn, controls.btnPrimary)} onClick={action.onClick}>
                    {action.label}
                </button>
            )}
        </div>
    );
}
