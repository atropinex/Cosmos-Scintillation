import {useEffect, useState} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {answerConfirm, useConfirm} from "../../controller/confirm/CosmosConfirm.Controller";
import CosmosModal from "../modal/CosmosModal";
import controls from "../shared/CosmosControls.module.css";
import styles from "./CosmosConfirmDialog.module.css";

/** The "are you sure?" box. Mounted once at the top of the app. */
export default function CosmosConfirmDialog() {
    const {request} = useConfirm();
    const [typed, setTyped] = useState("");
    const [shown, setShown] = useState(request);

    // Keep showing the last question while the dialog fades out.
    useEffect(() => {
        if (request) {
            setShown(request);
            setTyped("");
        }
    }, [request]);

    const needsText = Boolean(shown?.typeToConfirm);
    const ready = !needsText || typed === shown?.typeToConfirm;

    return (
        <CosmosModal
            open={request !== null}
            title={shown?.title ?? ""}
            width={440}
            onClose={() => answerConfirm(false)}
            footer={
                <>
                    {/* Cancel is the first button and the one that has focus, so Enter never deletes by accident. */}
                    <button className={controls.btn} autoFocus onClick={() => answerConfirm(false)}>Cancel</button>
                    <button
                        className={cx(controls.btn, shown?.danger ? controls.btnDangerSolid : controls.btnPrimary)}
                        disabled={!ready}
                        onClick={() => answerConfirm(true)}
                    >
                        {shown?.confirmLabel ?? "Confirm"}
                    </button>
                </>
            }
        >
            <p className={styles.message}>{shown?.message}</p>
            {needsText && (
                <label className={styles.typed}>
                    <span className={controls.hint}>Type <b>{shown?.typeToConfirm}</b> to continue</span>
                    <input
                        className={controls.field}
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        spellCheck={false}
                    />
                </label>
            )}
        </CosmosModal>
    );
}
