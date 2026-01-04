import style from './style.module.scss';
import slider from './slider.module.scss';

import type {ButtonHTMLAttributes, ComponentChildren, InputHTMLAttributes, JSX, Ref, TargetedEvent} from 'preact';
import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal, type Signal} from '@preact/signals';
import classNames from 'clsx';
import Icon, {IconType} from '../Icon/Icon';
import {Motif} from '../../util/motif';
import {formatTimestamp, parseTimestamp} from '../../util/format-timestamp';

export const Dropdown = <T extends string | number>({
    value,
    options,
    className,
    disabled,
    inputId,
    'aria-labelledby': labelledBy,
}: {
    value: Signal<T | null>;
    options: readonly {
        id: T;
        name: string;
    }[];
    className?: string;
    disabled?: boolean;
    inputId?: string;
    'aria-labelledby'?: string;
}): JSX.Element => {
    const handleChange = useCallback((event: Event) => {
        const select = event.target as HTMLSelectElement;
        if (select.selectedIndex !== -1) {
            value.value = options[select.selectedIndex].id;
        }
    }, [value, options]);

    return (
        <div className={classNames(style.selectWrapper, className, disabled && style.disabled)}>
            <select
                className={style.select}
                onChange={handleChange}
                disabled={disabled}
                id={inputId}
                aria-labelledby={labelledBy}
            >
                {options.map(({id, name}) => (
                    <option value={id} key={id} selected={id === value.value}>{name}</option>
                ))}
            </select>
        </div>
    );
};


export const SpinBox = ({
    value,
    customDisplay,
    min,
    max,
    sensitivity,
    step = 1,
    smartAim = 0,
    disabled,
    className,
    inputId,
    width,
    'aria-labelledby': labelledBy,
}: {
    value: Signal<number>;
    customDisplay?: SpinBoxDisplayFuncs,
    min?: number;
    max?: number;
    sensitivity?: number;
    step?: number | 'any';
    smartAim?: number;
    disabled?: boolean;
    className?: string;
    inputId?: string;
    width?: number;
    'aria-labelledby'?: string;
}): JSX.Element => {
    const handleInput = useCallback((newValue: number) => {
        value.value = newValue;
    }, [value]);

    return <ImperativeSpinBox
        value={value.value}
        onInput={handleInput}
        customDisplay={customDisplay}
        min={min}
        max={max}
        sensitivity={sensitivity}
        step={step}
        smartAim={smartAim}
        disabled={disabled}
        className={className}
        inputId={inputId}
        width={width}
        aria-labelledby={labelledBy}
    />;
};

export type SpinBoxDisplayFuncs = {
    display: (value: number) => string,
    parse: (value: string) => number | null,
};


export const timestampSpinboxDisplay = {
    display(value: number) {
        return formatTimestamp(value);
    },
    parse(value: string) {
        return parseTimestamp(value);
    },
};

export const ImperativeSpinBox = ({
    value,
    onInput,
    customDisplay,
    min,
    max,
    sensitivity,
    step = 1,
    smartAim = 0,
    disabled,
    className,
    inputId,
    width,
    'aria-labelledby': labelledBy,
}: {
    value: number;
    onInput: (value: number) => unknown,
    customDisplay?: SpinBoxDisplayFuncs,
    min?: number;
    max?: number;
    sensitivity?: number;
    step?: number | 'any';
    smartAim?: number;
    disabled?: boolean;
    className?: string;
    inputId?: string;
    width?: number;
    'aria-labelledby'?: string;
}): JSX.Element => {
    const currentValue = useRef(value);
    currentValue.current = value;

    const handleInput = useCallback((event: TargetedEvent<HTMLInputElement, InputEvent>) => {
        const newValue = customDisplay ?
            customDisplay.parse(event.currentTarget.value) :
            Number(event.currentTarget.value);
        if (newValue !== null) onInput(newValue);
    }, [currentValue, customDisplay?.parse, onInput]);

    const increment = useCallback(() => {
        let incremented = currentValue.current + (step === 'any' ? 1 : step);
        if (typeof max === 'number') incremented = Math.min(incremented, max);
        onInput(incremented);
    }, [currentValue, max, step, onInput]);

    const decrement = useCallback(() => {
        let decremented = currentValue.current - (step === 'any' ? 1 : step);
        if (typeof min === 'number') decremented = Math.max(decremented, min);
        onInput(decremented);
    }, [currentValue, min, step, onInput]);

    const spinboxId = useId();

    const isEditing = useSignal(false);

    const pointerListeners = useRef<{
        move: (event: PointerEvent) => unknown;
        up: (event: PointerEvent) => unknown;
    } | null>(null);
    useEffect(() => {
        return () => {
            if (pointerListeners.current) {
                window.removeEventListener('pointermove', pointerListeners.current.move);
                window.removeEventListener('pointerup', pointerListeners.current.up);
            }
        };
    }, []);

    // Drag up/down to change the value
    const handlePointerDown = useCallback((event: TargetedEvent<HTMLInputElement, PointerEvent>) => {
        // For the first drag, focus the input element and prevent selecting text until subsequent pointer events
        if (document.activeElement !== event.currentTarget) {
            event.preventDefault();
            event.currentTarget.focus();
        } else {
            return;
        }
        if (disabled) return;
        // Don't count up/down drags if the cursor is inside the spinbox
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        const deadZone = rect;
        const valueStart = currentValue.current;

        const onMove = (event: PointerEvent) => {
            let mouseDelta = 0;
            if (event.clientY < deadZone.top) {
                mouseDelta += event.clientY - deadZone.top;
            } else if (event.clientY > deadZone.bottom) {
                mouseDelta += event.clientY - deadZone.bottom;
            }

            if (event.clientX < deadZone.left) {
                mouseDelta -= event.clientX - deadZone.left;
            } else if (event.clientX > deadZone.right) {
                mouseDelta -= event.clientX - deadZone.right;
            }

            if (mouseDelta === 0) return;

            document.getSelection()?.empty();

            // 200px (in either direction; it's the "radius", not "diameter") for the slider to go from min to max
            let computedSensitivity;
            if (sensitivity) {
                computedSensitivity = sensitivity;
            } else if (typeof min === 'number' && typeof max === 'number') {
                computedSensitivity = (max - min) / 200;
            } else {
                computedSensitivity = 1;
            }
            const valueDelta = mouseDelta * computedSensitivity;

            const newValue = valueStart - valueDelta;
            let clampedValue = newValue;
            if (typeof max === 'number') clampedValue = Math.min(clampedValue, max);
            if (typeof min === 'number') clampedValue = Math.max(clampedValue, min);
            let roundedValue = step === 'any' ? clampedValue : Math.round(clampedValue / step) * step;
            if (smartAim > 0) {
                let roundedToAim = Math.round(newValue / smartAim) * smartAim;
                if (Math.abs(roundedToAim - newValue) < smartAim / 4) {
                    if (typeof max === 'number') roundedToAim = Math.min(roundedToAim, max);
                    if (typeof min === 'number') roundedToAim = Math.max(roundedToAim, min);
                    roundedValue = roundedToAim;
                }
            }
            onInput(roundedValue);
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        pointerListeners.current = {move: onMove, up: onUp};

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [min, max, sensitivity, currentValue, disabled]);

    const handleFocus = useCallback(() => {
        if (disabled) return;
        isEditing.value = true;
    }, [isEditing, disabled]);
    const handleBlur = useCallback(() => {
        isEditing.value = false;
        // Ensure the value is clamped to min/max when editing ends
        let clampedValue = currentValue.current;
        if (typeof max === 'number') clampedValue = Math.min(clampedValue, max);
        if (typeof min === 'number') clampedValue = Math.max(clampedValue, min);
        onInput(clampedValue);
    }, [isEditing, currentValue, min, max]);

    return (
        <div
            className={classNames(
                style.spinboxWrapper,
                className,
                disabled && style.disabled,
            )}
            aria-disabled={disabled}
            style={{
                width: width ? `calc(${width}ch + var(--padding-right) * 2 + 1rem)` : undefined,
            }}
        >
            <input
                className={classNames(
                    style.spinboxField,
                    !isEditing.value && style.spinboxIdle,
                    'tabular-nums',
                    disabled && style.disabled,
                )}
                type={customDisplay ? 'text' : 'number'}
                min={min}
                max={max}
                step={step}
                value={customDisplay ? customDisplay.display(value) : Number(value.toPrecision(12))}
                disabled={disabled}
                onInput={handleInput}
                id={inputId ?? spinboxId}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onPointerDown={handlePointerDown}
                aria-labelledby={labelledBy}
            />
            <div className={style.spinboxButtons}>
                <button
                    onClick={increment}
                    disabled={disabled || (value === max)}
                    className={style.spinboxButton}
                    role="button"
                    aria-controls={inputId ?? spinboxId}
                    aria-label="Increment"
                >
                    <div className={style.spinboxUp} />
                </button>
                <div className={style.spinboxButtonDivider} />
                <button
                    onClick={decrement}
                    disabled={disabled || (value === min)}
                    className={style.spinboxButton}
                    role="button"
                    aria-controls={inputId ?? spinboxId}
                    aria-label="Decrement"
                >
                    <div className={style.spinboxDown} />
                </button>
            </div>
        </div>
    );
};

export const Slider = ({
    value,
    min,
    max,
    step = 1,
    detents,
    disabled,
    className,
    id,
    'aria-labelledby': labelledBy,
}: {
    value: Signal<number>;
    min: number;
    max: number;
    step?: number | 'any';
    detents?: number[];
    disabled?: boolean;
    className?: string;
    id?: string;
    'aria-labelledby'?: string,
}): JSX.Element => {
    const handleInput = useCallback((event: TargetedEvent<HTMLInputElement, InputEvent>) => {
        const newValue = Number(event.currentTarget.value);
        value.value = newValue;
    }, [value]);

    return <ImperativeSlider
        value={value.value}
        onInput={handleInput}
        min={min}
        max={max}
        step={step}
        detents={detents}
        disabled={disabled}
        className={className}
        id={id}
        aria-labelledby={labelledBy}
    />;
};

const EMPTY_ARRAY: never[] = [];

export const ImperativeSlider = ({
    value,
    onInput,
    min,
    max,
    step = 1,
    detents,
    disabled,
    className,
    id,
    'aria-labelledby': labelledBy,
}: {
    value: number;
    onInput?: (event: TargetedEvent<HTMLInputElement, InputEvent>) => unknown;
    min: number;
    max: number;
    step?: number | 'any';
    detents?: number[];
    disabled?: boolean;
    className?: string;
    id?: string;
    'aria-labelledby'?: string,
}): JSX.Element => {
    const sliderInput = useRef<HTMLInputElement>(null);

    const handleInput = useCallback((event: TargetedEvent<HTMLInputElement, InputEvent>) => {
        // Update --val immediately from the DOM to stay in sync with the browser's knob position
        event.currentTarget.style.setProperty('--val', event.currentTarget.value);
        onInput?.(event);
    }, [onInput]);
    // If the detents array has the same contents as a previous one, use the previous one to maintain object identity
    const memoDetents = useMemo(() => detents, detents ?? EMPTY_ARRAY);
    const dlId = useId();

    const dataList = useMemo(() => {
        if (!memoDetents || memoDetents.length === 0) return null;
        return (
            <datalist id={dlId}>
                {memoDetents.map(value => <option value={value} />)}
            </datalist>
        );
    }, [dlId, memoDetents]);

    useLayoutEffect(() => {
        const slider = sliderInput.current!;
        slider.style.setProperty('--min', String(min));
        slider.style.setProperty('--max', String(max));
        slider.style.setProperty('--val', String(value));
    }, [value, min, max]);

    return (
        <input
            className={classNames(slider.slider, className)}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onInput={handleInput}
            ref={sliderInput}
            list={memoDetents?.length ? dlId : undefined}
            id={id}
            aria-labelledby={labelledBy}
        >{dataList}</input>
    );
};

export const ToggleIcon = ({type, title, toggled, innerRef, className}: {
    type: IconType;
    title: string;
    toggled: Signal<boolean>;
    innerRef?: Ref<HTMLButtonElement>;
    className?: string;
}) => {
    const handleClick = useCallback(() => {
        toggled.value = !toggled.value;
    }, [toggled]);
    return (
        <button
            className={classNames(style.iconButton, style.toggleIcon, toggled.value && style.toggledOn, className)}
            onClick={handleClick}
            role="checkbox"
            aria-checked={toggled.value}
            title={title}
            ref={innerRef}
            tabindex={0}
        >
            <Icon type={type} title={title} />
        </button>
    );
};

// eslint-disable-next-line @stylistic/comma-dangle
export const SelectableButton = <const T, >({children, title, currentValue, value, disabled}: {
    children?: ComponentChildren;
    title?: string;
    currentValue: Signal<T>;
    value: T;
    disabled?: boolean;
}) => {
    const handleClick = useCallback(() => {
        currentValue.value = value;
    }, [currentValue]);
    return (
        <button
            className={classNames(
                style.iconButton,
                style.toggleIcon,
                {[style.toggledOn]: currentValue.value === value},
            )}
            onClick={handleClick}
            role="radio"
            aria-checked={currentValue.value === value}
            title={title}
            tabindex={0}
            disabled={disabled}
        >
            {children}
        </button>
    );
};

export const CheckboxToggle = ({label, title, checked, disabled, indeterminate, className}: {
    label: string;
    title?: string | null;
    checked: Signal<boolean>;
    disabled?: boolean;
    indeterminate?: boolean;
    className?: string;
}) => {
    const handleInput = useCallback((event: TargetedEvent<HTMLInputElement>) => {
        event.preventDefault();
        checked.value = event.currentTarget.checked;
    }, [checked]);

    const preventSelection = useCallback((event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    }, []);

    const id = useId();

    return (
        <label
            className={classNames(style.checkboxToggle, disabled && style.disabled, className)}
            title={title ?? undefined}
            aria-disabled={disabled}
            for={id}
        >
            <input
                type="checkbox"
                checked={checked.value}
                onInput={handleInput}
                disabled={disabled}
                indeterminate={indeterminate}
                id={id}
            />
            <span className={style.checkboxLabel} onMouseDown={preventSelection}>{label}</span>
        </label>
    );
};

export const TextBox = ({
    value,
    small,
    className,
    ...props
}: {value: Signal<string>; small?: boolean} & InputHTMLAttributes<HTMLInputElement>) => {
    const updateTextbox = useCallback((event: TargetedEvent<HTMLInputElement>) => {
        value.value = event.currentTarget.value;
    }, [value]);

    return (
        <input
            type="text"
            className={classNames(className, small && style.small)}
            {...props}
            value={value}
            onInput={updateTextbox}
        />
    );
};

export const Button = ({children, className, ...props}: {
    children: ComponentChildren
} & ButtonHTMLAttributes<HTMLButtonElement>) => {
    return (
        <button {...props} className={classNames(style.button, className)}>
            <span className={style.buttonContents}>
                {children}
            </span>
        </button>
    );
};

export const CollapsibleHeader = ({collapsed, bodyId, children, auxiliaryItems, className}: {
    collapsed: Signal<boolean>;
    bodyId: string;
    children: ComponentChildren;
    auxiliaryItems?: ComponentChildren;
    className?: string;
}) => {
    const toggleCollapsed = useCallback(() => {
        collapsed.value = !collapsed.value;
    }, [collapsed]);

    return (
        <header className={className}>
            <button
                className={style.collapsibleHeaderTitle}
                aria-expanded={collapsed.value ? 'false' : 'true'}
                aria-controls={bodyId}
                onClick={toggleCollapsed}
            >
                <Icon type={collapsed.value ? 'arrow-right' : 'arrow-down'} title={null} motif={Motif.MONOCHROME} />
                <span className={style.collapsibleHeaderTitleText}>
                    {children}
                </span>
            </button>
            {auxiliaryItems}
        </header>
    );
};
