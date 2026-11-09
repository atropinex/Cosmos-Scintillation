import {useMemo, useRef, useState, type KeyboardEvent} from "react";
import {cx} from "../../../common/utils/ClassHelper";
import {formatJson, jsonProblem, sampleJson, type JsonHint} from "../../controller/json/CosmosJsonHint.Controller";
import controls from "./CosmosControls.module.css";
import CosmosFloatingWindow from "./CosmosFloatingWindow";
import styles from "./CosmosJsonEditor.module.css";

interface CosmosJsonEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Field names to suggest. Empty means plain formatting help only. */
    hints?: JsonHint[];
    placeholder?: string;
    ariaLabel?: string;
}

const PAIRS: Record<string, string> = {"{": "}", "[": "]", "\"": "\""};

/**
 * A box for JSON that helps while you type: suggests field names, fills in an example, closes brackets and quotes,
 * and lays the text out neatly (Ctrl+Shift+F, the Format button, or when you leave the box).
 */
export default function CosmosJsonEditor({value, onChange, hints = [], placeholder, ariaLabel}: CosmosJsonEditorProps) {
    const box = useRef<HTMLTextAreaElement>(null);
    const [caret, setCaret] = useState(0);
    const [choice, setChoice] = useState(0);
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [floating, setFloating] = useState(false);

    // The word being typed as a field name: after an opening quote that follows "{", "," or the start of the text.
    const typing = useMemo(() => {
        const before = value.slice(0, caret);
        const match = /"([A-Za-z0-9_]*)$/.exec(before);
        if (!match) {
            return null;
        }
        const start = match.index;
        const lead = before.slice(0, start).trimEnd();
        if (lead !== "" && !lead.endsWith("{") && !lead.endsWith(",")) {
            return null;
        }
        return {start, partial: match[1]};
    }, [value, caret]);

    const suggestions = useMemo(() => {
        if (!typing || !focused || hidden) {
            return [];
        }
        const used = new Set([...value.matchAll(/"([^"\\]+)"\s*:/g)].map((match) => match[1]));
        return hints.filter((hint) => !used.has(hint.key) && hint.key.toLowerCase().startsWith(typing.partial.toLowerCase())).slice(0, 8);
    }, [typing, hints, value, focused]);

    const problem = jsonProblem(value);

    const put = (text: string, position: number) => {
        onChange(text);
        setCaret(position);
        requestAnimationFrame(() => {
            box.current?.focus();
            box.current?.setSelectionRange(position, position);
        });
    };

    const accept = (hint: JsonHint) => {
        if (!typing) {
            return;
        }
        const end = caret + (value[caret] === "\"" ? 1 : 0);
        const literal = JSON.stringify(hint.example);
        const text = `"${hint.key}": ${literal}`;
        // A text value is left with the caret between its quotes, ready to type.
        const inside = typeof hint.example === "string" ? text.length - 1 : text.length;
        put(value.slice(0, typing.start) + text + value.slice(end), typing.start + inside);
    };

    const format = () => {
        const text = formatJson(value);
        if (text !== null && text !== value) {
            put(text, Math.min(caret, text.length));
        }
    };

    const insertField = (hint: JsonHint) => {
        const object = (() => {
            try {
                const parsed: unknown = value.trim() === "" ? {} : JSON.parse(value);
                return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
            } catch {
                return null;
            }
        })();
        if (object) {
            put(JSON.stringify({...object, [hint.key]: object[hint.key] ?? hint.example}, null, 2), value.length + 1);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const area = event.currentTarget;
        const start = area.selectionStart;
        const end = area.selectionEnd;

        if (suggestions.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setChoice((choice + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                accept(suggestions[Math.min(choice, suggestions.length - 1)]);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setHidden(true);
                return;
            }
        }

        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
            event.preventDefault();
            format();
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        // Typing an opening bracket or quote adds the closing one; typing the closing one steps over it.
        if (start === end && PAIRS[event.key]) {
            const next = value[start];
            if (event.key === "\"" && next === "\"") {
                event.preventDefault();
                put(value, start + 1);
                return;
            }
            if (event.key !== "\"" || !/[A-Za-z0-9_]/.test(value[start - 1] ?? "")) {
                event.preventDefault();
                put(value.slice(0, start) + event.key + PAIRS[event.key] + value.slice(end), start + 1);
                return;
            }
        }
        if (start === end && (event.key === "}" || event.key === "]") && value[start] === event.key) {
            event.preventDefault();
            put(value, start + 1);
            return;
        }
        // Enter between brackets opens an indented line.
        if (event.key === "Enter" && start === end && PAIRS[value[start - 1]] === value[start] && value[start] !== "\"") {
            event.preventDefault();
            put(`${value.slice(0, start)}\n  \n${value.slice(end)}`, start + 3);
            return;
        }
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            put(`${value.slice(0, start)}  ${value.slice(end)}`, start + 2);
        }
    };

    const core = (
        <>
            <div className={styles.field}>
            <textarea
                ref={box}
                className={cx(controls.field, controls.mono, styles.area, problem && value.trim() !== "" && styles.invalid)}
                value={value}
                placeholder={placeholder}
                aria-label={ariaLabel ?? "JSON"}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                    onChange(event.target.value);
                    setCaret(event.target.selectionStart);
                    setChoice(0);
                    setHidden(false);
                }}
                onSelect={(event: {currentTarget: HTMLTextAreaElement}) => setCaret(event.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                    setFocused(false);
                    format();
                }}
            />

            {suggestions.length > 0 && (
                <ul className={styles.popup} role="listbox">
                    {suggestions.map((hint, index) => (
                        <li key={hint.key}>
                            <button
                                type="button" role="option" aria-selected={index === choice}
                                className={cx(styles.option, index === choice && styles.chosen)}
                                // The box must keep focus, so the choice is made before it loses it.
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    accept(hint);
                                }}
                            >
                                <b>{hint.key}</b><span>{hint.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            </div>

            <div className={styles.tools}>
                {hints.length > 0 && (
                    <button type="button" className={controls.btn} onClick={() => put(sampleJson(hints), 0)} title="Fill in every field this API expects">Fill in fields</button>
                )}
                <button type="button" className={controls.btn} onClick={format} disabled={problem !== ""} title="Lay the text out neatly (Ctrl+Shift+F)">Format</button>
                {hints.slice(0, 6).map((hint) => (
                    <button key={hint.key} type="button" className={styles.chip} onClick={() => insertField(hint)} title={`Add "${hint.key}"`}>+ {hint.key}</button>
                ))}
                <button type="button" className={controls.btn} onClick={() => setFloating(!floating)} title={floating ? "Put the box back in the page" : "Open the box in a window you can move and resize"}>
                    {floating ? "Dock" : "Pop out"}
                </button>
                {problem !== "" && value.trim() !== "" && <span className={styles.problem}>Not valid yet: {problem}</span>}
            </div>
        </>
    );

    if (floating) {
        return (
            <>
                <div className={styles.docked}>
                    <span>Editing in a separate window.</span>
                    <button type="button" className={controls.btn} onClick={() => setFloating(false)}>Dock</button>
                </div>
                <CosmosFloatingWindow id="json-editor" title={ariaLabel ?? "JSON"} onClose={() => setFloating(false)}>
                    <div className={cx(styles.editor, styles.fill)}>{core}</div>
                </CosmosFloatingWindow>
            </>
        );
    }
    return <div className={styles.editor}>{core}</div>;
}
