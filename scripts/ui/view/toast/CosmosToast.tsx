import {cx} from "../../../common/utils/ClassHelper";
import {useToast} from "../../controller/toast/CosmosToast.Controller";
import styles from "./CosmosToast.module.css";

export default function CosmosToast() {
    const toast = useToast();

    return (
        <div
            className={cx(styles.toast, toast.visible && styles.show, toast.isError && styles.error)}
            role="status"
            aria-live="polite"
        >
            {toast.message}
        </div>
    );
}
