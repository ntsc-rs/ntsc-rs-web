import {batch, computed, effect, ReadonlySignal, signal, Signal} from '@preact/signals';
import {createContext} from 'preact';
import {useContext} from 'preact/hooks';

import {
    DescriptorKind,
    NtscSettingsList,
    SettingDescriptor,
    ResizeFilter,
} from '../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';
import throttle from './util/throttle';
import type {StateChangeEvent} from './util/render-job';
import {GLOBAL_WORKER_POOL} from './util/effect-worker-pool';
import OpfsRenderJobManager, {RenderJobLike} from './util/opfs-render-jobs';
import SETTING_DESCRIPTORS from './generated/setting-descriptors';
import {wasmModulePromise} from './util/ntsc-rs-module';

const renderJobPromise = import('./util/render-job');
const settingsListPromise = wasmModulePromise.then(() => new NtscSettingsList());

export type EffectPreviewMode = 'enabled' | 'disabled' | 'split';

export type AppVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1';

export type RenderJobListState =
    | {state: 'loading'}
    | {state: 'loaded', jobs: Signal<RenderJobLike[]>}
    | {state: 'error', error: unknown};

export class AppState {
    settings: Record<string, Signal<number | boolean>>;
    defaultSettings: Record<string, number | boolean>;
    settingsAsObject: ReadonlySignal<Record<string, number | boolean>>;

    resizeEnabled: Signal<boolean>;
    resizeHeight: Signal<number>;
    resizeFilter: Signal<ResizeFilter>;

    mute: Signal<boolean>;
    volume: Signal<number>;

    zoomFit: Signal<boolean>;
    zoomPercent: Signal<number>;
    effectPreviewMode: Signal<EffectPreviewMode>;
    previewSplitRect: {
        top: Signal<number>,
        bottom: Signal<number>,
        left: Signal<number>,
        right: Signal<number>,
    };
    previewSplitRectAsObject: ReadonlySignal<{
        top: number,
        bottom: number,
        left: number,
        right: number,
    } | null>;

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
        const defaultSettings: Record<string, number | boolean> = {};

        const addFromDescriptors = (descriptors: SettingDescriptor[]) => {
            for (const descriptor of descriptors) {
                flatSettings[descriptor.idName] = signal(descriptor.value.defaultValue);
                defaultSettings[descriptor.idName] = descriptor.value.defaultValue;
                if (descriptor.kind === DescriptorKind.Group) {
                    addFromDescriptors(descriptor.value.children);
                }
            }
        };

        addFromDescriptors(SETTING_DESCRIPTORS);

        this.settings = flatSettings;
        this.defaultSettings = defaultSettings;
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
        this.previewSplitRect = {
            top: signal(0.0),
            bottom: signal(1.0),
            left: signal(0.0),
            right: signal(0.5),
        };
        this.previewSplitRectAsObject = computed(() => {
            if (this.effectPreviewMode.value !== 'split') return null;
            return {
                top: this.previewSplitRect.top.value,
                right: this.previewSplitRect.right.value,
                bottom: this.previewSplitRect.bottom.value,
                left: this.previewSplitRect.left.value,
            };
        });
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

    async settingsFromJSON(json: string) {
        if (!json.trimStart().startsWith('{')) {
            throw new Error('Not a JSON preset');
        }
        const settingsList = await settingsListPromise;
        const mergedSettings = JSON.parse(settingsList.parsePreset(json)) as Record<string, number | boolean>;
        this.settingsFromObject(mergedSettings);
    }

    destroy() {
        for (const cb of this.cleanupCallbacks) {
            cb();
        }
        this.cleanupCallbacks.length = 0;
    }

    async addRenderJob(
        destination: FileSystemFileHandle,
        mediaBlob: File,
        isOPFS: boolean,
    ) {
        if (!this.renderVideoCodec.value || this.renderJobs.value.state !== 'loaded') return;
        const RenderJob = (await renderJobPromise).default;
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
                    outputRect: null,
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
        await this.addRenderJob(destinationFile, mediaBlob, true);
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
