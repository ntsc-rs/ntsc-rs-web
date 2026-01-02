import {batch, computed, effect, ReadonlySignal, signal, Signal} from '@preact/signals';
import {createContext} from 'preact';
import {useContext} from 'preact/hooks';

import init, {
    DescriptorKind,
    NtscSettingsList,
    SettingDescriptor,
    ResizeFilter,
    setPanicHook,
} from 'ntsc-rs-web-wrapper';
import throttle from './util/throttle';
import RenderJob from './util/render-job';
import {GLOBAL_WORKER_POOL} from './util/effect-worker-pool';
await init();
//await initThreadPool(8);

export type EffectPreviewMode = 'enabled' | 'disabled';

export type AppVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1';

export class AppState {
    settings: Record<string, Signal<number | boolean>>;
    settingsAsObject: ReadonlySignal<Record<string, number | boolean>>;

    resizeEnabled: Signal<boolean>;
    resizeHeight: Signal<number>;
    resizeFilter: Signal<ResizeFilter>;

    mute: Signal<boolean>;
    volume: Signal<number>;

    zoomFit: Signal<boolean>;
    zoomPercent: Signal<number>;
    effectPreviewMode: Signal<EffectPreviewMode>;

    renderVideoCodec: Signal<AppVideoCodec | null>;
    renderVideoBitrate: Signal<number>;

    renderJobs: Signal<RenderJob[]>;
    mediaBlob: Signal<File | null>;
    private cleanupCallbacks: (() => unknown)[] = [];

    constructor() {
        const flatSettings: Record<string, Signal<number | boolean>> = {};

        const addFromDescriptors = (descriptors: SettingDescriptor[]) => {
            for (const descriptor of descriptors) {
                flatSettings[descriptor.idName] = signal(descriptor.value.defaultValue);
                if (descriptor.kind === DescriptorKind.Group) {
                    addFromDescriptors(descriptor.value.children);
                }
            }
        };

        addFromDescriptors(SETTINGS_DESCRIPTORS);

        this.settings = flatSettings;
        this.settingsAsObject = computed(() => {
            const settingValues: Record<string, number | boolean> = {};
            for (const settingId in this.settings) {
                if (!Object.prototype.hasOwnProperty.call(this.settings, settingId)) {
                    continue;
                }

                settingValues[settingId] = this.settings[settingId].value;
            }
            settingValues.version = 1;
            return settingValues;
        });
        this.resizeEnabled = signal(true);
        this.resizeHeight = signal(480);
        this.resizeFilter = signal(ResizeFilter.Bilinear);
        this.mute = signal(false);
        this.volume = signal(100);
        this.zoomFit = signal(true);
        this.zoomPercent = signal(100);
        this.effectPreviewMode = signal('enabled' as const);
        this.renderVideoCodec = signal('avc');
        this.renderVideoBitrate = signal(10);
        this.renderJobs = signal([]);
        this.mediaBlob = signal(null);

        loadState(this);

        const persistSettings = (settings: SavedState) => {
            localStorage.setItem('settings', JSON.stringify(settings));
        };
        const persistSettingsThrottled = throttle(persistSettings, 1000, true);

        this.cleanupCallbacks.push(effect(() => {
            const savedState = {
                settings: this.settingsAsObject.value,
                resizeEnabled: this.resizeEnabled.value,
                resizeHeight: this.resizeHeight.value,
                resizeFilter: this.resizeFilter.value,
                mute: this.mute.value,
                volume: this.volume.value,
                renderVideoCodec: this.renderVideoCodec.value,
                renderVideoBitrate: this.renderVideoBitrate.value,
                version: 1 as const,
            };

            persistSettingsThrottled(savedState);
        }));
    }

    settingsFromObject(settingsObj: Record<string, number | boolean>) {
        batch(() => {
            for (const settingId in settingsObj) {
                if (
                    !Object.prototype.hasOwnProperty.call(settingsObj, settingId) ||
                    !Object.prototype.hasOwnProperty.call(this.settings, settingId)
                ) {
                    continue;
                }

                this.settings[settingId].value = settingsObj[settingId];
            }
        });
    }

    settingsFromJSON(json: string) {
        const mergedSettings = JSON.parse(SETTINGS_LIST.parsePreset(json)) as Record<string, number | boolean>;
        this.settingsFromObject(mergedSettings);
    }

    destroy() {
        for (const cb of this.cleanupCallbacks) {
            cb();
        }
        this.cleanupCallbacks.length = 0;
    }

    addRenderJob(destination: FileSystemFileHandle, fileName: string | null) {
        if (!this.mediaBlob.value || !this.renderVideoCodec.value) return;
        const renderJob = new RenderJob(this.mediaBlob.value, fileName, destination, GLOBAL_WORKER_POOL, {
            videoCodec: this.renderVideoCodec.value,
            videoBitrate: this.renderVideoBitrate.value * 1000 * 1000,
            effectSettings: {
                resizeHeight: this.resizeEnabled.value ? this.resizeHeight.value : null,
                resizeFilter: this.resizeFilter.value,
                effectEnabled: true,
                effectSettings: this.settingsAsObject.value,
            },
            stillImageDuration: 60,
            stillImageFrameRate: 30,
        });

        const newRenderJobs = this.renderJobs.value.slice(0);
        newRenderJobs.push(renderJob);
        this.renderJobs.value = newRenderJobs;
    }

    removeRenderJob(removedJob: RenderJob) {
        this.renderJobs.value = this.renderJobs.value.filter(job => job !== removedJob);
    }
}

export const AppContext = createContext<AppState | undefined>(undefined);

/**
 * Hook for accessing global application state
 */
export const useAppState = (): AppState => {
    const context = useContext(AppContext);
    if (!context) throw new Error('No AppState provided');
    return context;
};

setPanicHook();
export const SETTINGS_LIST = new NtscSettingsList();
export const SETTINGS_DESCRIPTORS = JSON.parse(SETTINGS_LIST.getSettingsList()) as SettingDescriptor[];

type SavedState = {
    settings: Record<string, number | boolean>,
    resizeEnabled: boolean,
    resizeHeight: number,
    resizeFilter: ResizeFilter,
    mute: boolean,
    volume: number,
    version: 1,
    renderVideoCodec: AppVideoCodec | null,
    renderVideoBitrate: number,
};

const loadState = (store: AppState) => {
    const savedStateJson = localStorage.getItem('settings');
    if (!savedStateJson) return;
    try {
        const savedState = JSON.parse(savedStateJson) as SavedState;
        if (savedState.version !== 1) return;

        for (const settingId in savedState.settings) {
            if (
                !Object.prototype.hasOwnProperty.call(savedState.settings, settingId) ||
                !Object.prototype.hasOwnProperty.call(store.settings, settingId)
            ) {
                continue;
            }

            store.settings[settingId].value = savedState.settings[settingId];
        }

        store.resizeEnabled.value = savedState.resizeEnabled;
        store.resizeHeight.value = savedState.resizeHeight;
        store.resizeFilter.value = savedState.resizeFilter;
        store.mute.value = savedState.mute;
        store.volume.value = savedState.volume;
        store.renderVideoCodec.value = savedState.renderVideoCodec;
        store.renderVideoBitrate.value = savedState.renderVideoBitrate;
    } catch {
        // Swallow errors here
    }
};
