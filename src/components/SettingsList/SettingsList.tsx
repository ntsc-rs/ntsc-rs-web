import style from './style.module.scss';

import {Signal} from '@preact/signals';
import {DescriptorKind, ResizeFilter, SettingDescriptor} from '../../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';
import {useCallback, useId} from 'preact/hooks';
import {SETTINGS_DESCRIPTORS, SETTINGS_LIST, useAppState} from '../../app-state';
import {CheckboxToggle, Dropdown, Slider, SpinBox} from '../Widgets/Widgets';
import classNames from 'clsx';
import {IconButton} from '../Icon/Icon';
import {useAddErrorToast} from '../Toast/Toast';
import saveToFile from '../../util/save-to-file';
import showOpenFilePicker from '../../util/file-picker';

export const SliderWithSpinBox = (
    {min, max, step, value, disabled, 'aria-labelledby': labelledBy}: {
        min: number,
        max: number,
        step?: number | 'any',
        value: Signal<number>,
        disabled?: boolean,
        'aria-labelledby'?: string,
    },
) => {
    return (
        <div className={style.sliderWithSpinbox}>
            <Slider min={min} max={max} step={step} value={value} disabled={disabled} aria-labelledby={labelledBy} />
            <SpinBox
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                aria-labelledby={labelledBy}
                width={5}
            />
        </div>
    );
};

const CheckBox = (
    {checked, label, description, className, disabled}: {
        checked: Signal<boolean>,
        label: string,
        description: string | null,
        className?: string,
        disabled?: boolean,
    },
) => {
    const handleInput = useCallback((event: Event) => {
        checked.value = (event.target as HTMLInputElement).checked;
    }, [checked]);
    return (
        <label title={description ?? undefined} className={classNames(style.checkbox, className)}>
            <input
                className={style.checkboxInput}
                type="checkbox"
                checked={checked.value}
                onInput={handleInput}
                disabled={disabled}
            />
            {label}
        </label>
    );
};

const GroupBox = (
    {checked, label, description, children, disabled, settingsMap}: {
        checked: Signal<boolean>,
        label: string,
        description: string | null,
        disabled?: boolean,
        settingsMap: Record<string, Signal<number | boolean>>,
        children: SettingDescriptor[]
    },
) => {
    return (
        <div className={style.groupBox}>
            <div className={style.groupBoxTopEdge}>
                <div className={style.groupBoxBorderLeft} />
                <CheckBox
                    className={style.groupCheckbox}
                    checked={checked}
                    label={label}
                    description={description}
                    disabled={disabled}
                />
                <div className={style.groupBoxBorderRight} />
                <div className={style.groupBoxBorderRest} />
            </div>
            <div className={classNames(style.groupBoxChildren, (disabled || !checked.value) && style.disabled)}>
                {children.map(
                    descriptor => <Setting
                        descriptor={descriptor}
                        value={settingsMap[descriptor.idName]}
                        settingsMap={settingsMap}
                        disabled={disabled || !checked.value}
                        key={descriptor.id}
                    />,
                )}
            </div>
        </div>
    );
};

const Setting = (
    {descriptor, value, settingsMap, disabled}: {
        descriptor: SettingDescriptor,
        value: Signal<number | boolean>,
        settingsMap: Record<string, Signal<number | boolean>>,
        disabled: boolean,
    }) => {
    const labelId = useId();

    let innerWidget;
    switch (descriptor.kind) {
        case DescriptorKind.Enumeration: {
            innerWidget = <Dropdown
                value={value as Signal<number>}
                options={descriptor.value.options.map(item => ({id: item.index, name: item.label}))}
                disabled={disabled}
                aria-labelledby={labelId}
            />;
            break;
        }
        case DescriptorKind.Percentage: {
            innerWidget = <SliderWithSpinBox
                value={value as Signal<number>}
                min={0}
                max={1}
                step={0.001}
                disabled={disabled}
                aria-labelledby={labelId}
            />;
            break;
        }
        case DescriptorKind.IntRange: {
            innerWidget = <SliderWithSpinBox
                value={value as Signal<number>}
                min={descriptor.value.min}
                max={descriptor.value.max}
                step={1}
                disabled={disabled}
                aria-labelledby={labelId}
            />;
            break;
        }
        case DescriptorKind.FloatRange: {
            innerWidget = <SliderWithSpinBox
                value={value as Signal<number>}
                min={descriptor.value.min}
                max={descriptor.value.max}
                step={0.001}
                disabled={disabled}
                aria-labelledby={labelId}
            />;
            break;
        }
        case DescriptorKind.Boolean: {
            innerWidget = <CheckBox
                checked={value as Signal<boolean>}
                label={descriptor.label}
                description={descriptor.description}
                disabled={disabled}
            />;
            break;
        }
        case DescriptorKind.Group: {
            innerWidget = <GroupBox
                checked={value as Signal<boolean>}
                label={descriptor.label}
                description={descriptor.description}
                disabled={disabled}
                children={descriptor.value.children}
                settingsMap={settingsMap}
            />;
            break;
        }
    }

    return (
        <div className={style.setting}>
            {innerWidget}
            {descriptor.kind === DescriptorKind.Boolean || descriptor.kind === DescriptorKind.Group ?
                null :
                <label
                    className={style.settingLabel}
                    id={labelId}
                    title={descriptor.description ?? undefined}
                >{descriptor.label}</label>}
        </div>
    );
};

const filterDropdownOptions = [
    {id: ResizeFilter.Nearest, name: 'Nearest'},
    {id: ResizeFilter.Bilinear, name: 'Bilinear'},
    {id: ResizeFilter.Bicubic, name: 'Bicubic'},
] as const;

const SettingsList = () => {
    const appState = useAppState();

    return (
        <div className={style.settingsList}>
            <div className={style.resizeSetting}>
                <CheckboxToggle label="Resize to" checked={appState.resizeEnabled} />
                <SpinBox value={appState.resizeHeight} min={1} max={2000} smartAim={120} />
                lines
                <Dropdown
                    value={appState.resizeFilter}
                    options={filterDropdownOptions}
                    className={style.resizeDropdown}
                />
            </div>
            {SETTINGS_DESCRIPTORS.map(
                descriptor => <Setting
                    descriptor={descriptor}
                    value={appState.settings[descriptor.idName]}
                    settingsMap={appState.settings}
                    disabled={false}
                />,
            )}
        </div>
    );
};

const PresetsButtons = () => {
    const appState = useAppState();
    const addErrorToast = useAddErrorToast();

    const copySettings = useCallback(() => {
        navigator.clipboard.writeText(JSON.stringify(appState.settingsAsObject.value))
            .then(undefined, err => addErrorToast('Error copying preset', err));
    }, [appState]);

    const pasteSettings = useCallback(() => {
        navigator.clipboard.readText()
            .then(settingsJSON => {
                appState.settingsFromJSON(settingsJSON);
            })
            .catch(err => {
                addErrorToast('Error pasting preset', err);
            });
    }, [appState]);

    const saveSettings = useCallback(() => {
        const settingsStr = JSON.stringify(appState.settingsAsObject.value);
        const settingsBlob = new Blob([new TextEncoder().encode(settingsStr)], {type: 'application/json'});
        saveToFile('preset.json', settingsBlob);
    }, [appState]);

    const loadSettings = useCallback(() => {
        showOpenFilePicker({accept: 'application/json'})
            .then(files => {
                if (files?.[0]) {
                    return files?.[0].text();
                }
            })
            .then(settingsJSON => {
                if (settingsJSON) appState.settingsFromJSON(settingsJSON);
            })
            .catch(err => {
                addErrorToast('Error loading preset', err);
            });
    }, [appState]);

    const resetSettings = useCallback(() => {
        appState.settingsFromJSON(SETTINGS_LIST.defaultPreset());
    }, [appState]);

    return (
        <div className={style.presetsRow}>
            <div className={style.presetsLabel}>Presets</div>
            <div className={style.presetsButtons}>
                <IconButton
                    type="copy"
                    title="Copy preset to clipboard"
                    onClick={copySettings}
                />
                <IconButton
                    type="paste"
                    title="Paste preset from clipboard"
                    onClick={pasteSettings}
                />
                <IconButton
                    type="download"
                    title="Save preset to file"
                    onClick={saveSettings}
                />
                <IconButton
                    type="upload"
                    title="Load preset from file"
                    onClick={loadSettings}
                />
                <IconButton
                    type="reset"
                    title="Reset settings"
                    onClick={resetSettings}
                />
            </div>
        </div>
    );
};

const SettingsPane = () => {
    return (
        <div className={style.settingsPane}>
            <SettingsList />
            <PresetsButtons />
        </div>
    );
};

export default SettingsPane;
