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
import RenderJob, {StateChangeEvent} from './util/render-job';
import {GLOBAL_WORKER_POOL} from './util/effect-worker-pool';
import OpfsRenderJobManager, {RenderJobLike} from './util/opfs-render-jobs';
await init();

export type EffectPreviewMode = 'enabled' | 'disabled';

export type AppVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1';

export type RenderJobListState =
    | {state: 'loading'}
    | {state: 'loaded', jobs: Signal<RenderJobLike[]>}
    | {state: 'error', error: unknown};

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

    stillImageFrameRate: Signal<number>;

    renderVideoCodec: Signal<AppVideoCodec | null>;
    renderVideoBitrate: Signal<number>;
    renderStillImageDuration: Signal<number>;

    renderJobs: Signal<RenderJobListState>;
    mediaBlob: Signal<File | null>;
    private cleanupCallbacks: (() => unknown)[] = [];
    private opfsRenderJobManager = new OpfsRenderJobManager();

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
        this.stillImageFrameRate = signal(30);
        this.renderVideoCodec = signal('avc');
        this.renderVideoBitrate = signal(10);
        this.renderStillImageDuration = signal(60);
        this.renderJobs = signal({state: 'loading'});
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
                stillImageFrameRate: this.stillImageFrameRate.value,
                mute: this.mute.value,
                volume: this.volume.value,
                renderVideoCodec: this.renderVideoCodec.value,
                renderVideoBitrate: this.renderVideoBitrate.value,
                renderStillImageDuration: this.renderStillImageDuration.value,
                version: 1 as const,
            };

            persistSettingsThrottled(savedState);
        }));

        this.opfsRenderJobManager.initAndDoCleanup().then(
            renderJobs => {
                this.renderJobs.value = {state: 'loaded', jobs: signal(renderJobs)};
            },
            error => {
                this.renderJobs.value = {state: 'error', error};
            },
        );
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

    addRenderJob(
        destination: FileSystemFileHandle,
        mediaBlob: File,
        isOPFS: boolean,
    ) {
        if (!this.renderVideoCodec.value || this.renderJobs.value.state !== 'loaded') return;
        const renderJob = new RenderJob(
            mediaBlob,
            mediaBlob.name,
            destination,
            GLOBAL_WORKER_POOL,
            {
                videoCodec: this.renderVideoCodec.value,
                videoBitrate: this.renderVideoBitrate.value * 1000 * 1000,
                effectSettings: {
                    resizeHeight: this.resizeEnabled.value ? this.resizeHeight.value : null,
                    resizeFilter: this.resizeFilter.value,
                    effectEnabled: true,
                    effectSettings: this.settingsAsObject.value,
                },
                stillImageDuration: this.renderStillImageDuration.value,
                stillImageFrameRate: this.stillImageFrameRate.value,
            },
            isOPFS,
        );
        const onStateChange = (event: StateChangeEvent) => {
            if (
                this.renderJobs.value.state === 'loaded' &&
                (event.state.state === 'completed' || event.state.state === 'error')
            ) {
                void this.opfsRenderJobManager.persistRenderList(this.renderJobs.value.jobs.value);
                renderJob.removeEventListener('statechange', onStateChange);
            }
        };
        renderJob.addEventListener('statechange', onStateChange);

        const newRenderJobs = this.renderJobs.value.jobs.value.slice(0);
        newRenderJobs.push(renderJob);
        this.renderJobs.value.jobs.value = newRenderJobs;
    }

    async addOPFSRenderJob(mediaBlob: File) {
        if (!this.renderVideoCodec.value) return;
        const destinationFile = await this.opfsRenderJobManager.newRenderFile(this.renderVideoCodec.value);
        this.addRenderJob(destinationFile, mediaBlob, true);
    }

    async removeRenderJob(removedJob: RenderJobLike) {
        if (this.renderJobs.value.state !== 'loaded') return;
        this.renderJobs.value.jobs.value = this.renderJobs.value.jobs.value.filter(job => job !== removedJob);
        await this.opfsRenderJobManager.removeRenderJob(removedJob);
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

type SavedState = Partial<{
    settings: Record<string, number | boolean>,
    resizeEnabled: boolean,
    resizeHeight: number,
    resizeFilter: ResizeFilter,
    stillImageFrameRate: number,
    mute: boolean,
    volume: number,
    renderVideoCodec: AppVideoCodec | null,
    renderVideoBitrate: number,
    renderStillImageDuration: number,
}> & {version: 1};

const loadState = (store: AppState) => {
    const savedStateJson = localStorage.getItem('settings');
    if (!savedStateJson) return;
    try {
        const savedState = JSON.parse(savedStateJson) as SavedState;
        if (savedState.version !== 1) return;

        if (savedState.settings) {
            store.settingsFromObject(savedState.settings);
        }

        for (const key of [
            'resizeEnabled',
            'resizeHeight',
            'resizeFilter',
            'stillImageFrameRate',
            'mute',
            'volume',
            'renderVideoCodec',
            'renderVideoBitrate',
            'renderStillImageDuration',
        ] as const) {
            if (typeof savedState[key] !== 'undefined') {
                store[key].value = savedState[key];
            }
        }
    } catch (err) {
        // Swallow errors here
        // eslint-disable-next-line no-console
        console.warn('Failed to load saved app state:', err);
    }
};
