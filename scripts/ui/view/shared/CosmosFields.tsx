import {useState, type ReactNode} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import controls from "./CosmosControls.module.css";
import CosmosIcon from "./CosmosIcon";
import styles from "./CosmosFields.module.css";

// === A label and a control on one line === //

interface RowProps {
    label: string;
    hint?: string;
    children: ReactNode;
}

function Row({label, hint, children}: RowProps) {
    return (
        <label className={styles.row}>
            <span className={styles.label} title={label}>{label}</span>
            <span className={styles.control}>{children}</span>
            {hint && <span className={styles.hint}>{hint}</span>}
        </label>
    );
}

interface TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    mono?: boolean;
    hint?: string;
}

export function TextField({label, value, onChange, placeholder, mono, hint}: TextFieldProps) {
    return (
        <Row label={label} hint={hint}>
            <input
                className={cx(controls.field, mono && styles.mono)}
                value={value}
                placeholder={placeholder}
                spellCheck={false}
                onChange={(event) => onChange(event.target.value)}
            />
        </Row>
    );
}

interface NumberFieldProps {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    hint?: string;
}

/** Keeps what the user is typing as text, and only reports numbers that are valid. */
export function NumberField({label, value, onChange, min = -1e9, max = 1e9, step = 1, hint}: NumberFieldProps) {
    const [draft, setDraft] = useState<string | null>(null);

    const type = (text: string) => {
        setDraft(text);
        const parsed = Number(text);
        if (text.trim() !== "" && Number.isFinite(parsed)) {
            onChange(Math.min(max, Math.max(min, parsed)));
        }
    };

    return (
        <Row label={label} hint={hint}>
            <input
                className={controls.field}
                type="number"
                min={min}
                max={max}
                step={step}
                value={draft ?? String(value)}
                onChange={(event) => type(event.target.value)}
                onBlur={() => setDraft(null)}
            />
        </Row>
    );
}

interface SelectFieldProps {
    label: string;
    value: string;
    options: Array<{value: string; label: string}>;
    onChange: (value: string) => void;
    hint?: string;
}

export function SelectField({label, value, options, onChange, hint}: SelectFieldProps) {
    return (
        <Row label={label} hint={hint}>
            <select className={controls.field} value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </Row>
    );
}

interface ToggleFieldProps {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    hint?: string;
}

export function ToggleField({label, value, onChange, hint}: ToggleFieldProps) {
    return (
        <div className={styles.row}>
            <span className={styles.label} title={label}>{label}</span>
            <span className={styles.control}>
                <button
                    type="button"
                    role="switch"
                    aria-checked={value}
                    aria-label={label}
                    className={controls.switch}
                    onClick={() => onChange(!value)}
                />
            </span>
            {hint && <span className={styles.hint}>{hint}</span>}
        </div>
    );
}

// === A group of fields that can be folded away === //

interface SectionProps {
    title: string;
    defaultOpen?: boolean;
    children: ReactNode;
}

export function Section({title, defaultOpen = true, children}: SectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section className={styles.section}>
            <button className={cx(styles.sectionHead, open && styles.open)} onClick={() => setOpen(!open)}>
                <CosmosIcon name="chevronRight" size={14}/>
                {title}
            </button>
            {open && <div className={styles.sectionBody}>{children}</div>}
        </section>
    );
}
