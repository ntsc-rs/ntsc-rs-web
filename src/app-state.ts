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
import {GLOBAL_WORKER_POOL, PanicEvent} from './util/effect-worker-pool';
import OpfsRenderJobManager, {RenderJobLike} from './util/opfs-render-jobs';
import Directory from './util/signalize-fs';
import SETTING_DESCRIPTORS from '../ntsc-rs-web-wrapper/build/setting-descriptors';
import {wasmModulePromise} from './util/ntsc-rs-module';
import Undoer from './util/undoer';

const renderJobPromise = import('./util/render-job');
const settingsListPromise = wasmModulePromise.then(() => new NtscSettingsList());

export type EffectPreviewMode = 'enabled' | 'disabled' | 'split';

export type AppVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1';

export type RenderJobListState =
    | {state: 'loading'}
    | {state: 'loaded', jobs: Signal<RenderJobLike[]>}
    | {state: 'error', error: unknown};

export type SelectedPreset = {
    path: string;
    handle: FileSystemFileHandle;
    originalSettings: SettingsObj;
};

export type PresetsDirState =
    | {state: 'not_loaded'}
    | {state: 'loading'}
    | {state: 'loaded', root: {dir: Directory, path: string}}
    | {state: 'error', error: unknown};

export type PresetsState = {
    presetsDir: Signal<PresetsDirState>;
    selectedPreset: Signal<SelectedPreset | null>;
    presetsPanelOpen: Signal<boolean>;
};

export type SettingsObj = Record<string, number | boolean>;

export class AppState {
    settings: Record<string, Signal<number | boolean>>;
    defaultSettings: SettingsObj;
    settingsAsObject: ReadonlySignal<SettingsObj>;
    canUndo: Signal<boolean>;
    canRedo: Signal<boolean>;

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
    presetsState: PresetsState;
    private cleanupCallbacks: (() => unknown)[] = [];
    private opfsRenderJobManager = new OpfsRenderJobManager();
    private undoer: Undoer<SettingsObj>;
    private isUndoing = true;

    isPortrait: ReadonlySignal<boolean>;
    disclaimerModalOpen = signal(true);
    disclaimerModalDismissed = signal(false);
    panicMessage: Signal<string | null> = signal(null);

    constructor() {
        const flatSettings: Record<string, Signal<number | boolean>> = {};
        const defaultSettings: SettingsObj = {};

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
            const settingValues: SettingsObj = {};
            for (const settingId in this.settings) {
                if (!Object.prototype.hasOwnProperty.call(this.settings, settingId)) {
                    continue;
                }

                settingValues[settingId] = this.settings[settingId].value;
            }
            settingValues.version = 1;
            return settingValues;
        });
        this.undoer = new Undoer(1000, 25);
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
        this.presetsState = {
            presetsDir: signal({state: 'not_loaded'}),
            selectedPreset: signal(null),
            presetsPanelOpen: signal(false),
        };

        this.canUndo = signal(this.undoer.canUndo);
        this.canRedo = signal(this.undoer.canRedo);
        this.cleanupCallbacks.push(effect(() => {
            const settingsObj = this.settingsAsObject.value;
            // Avoid a "press undo -> update settings -> that creates another undo point" loop
            if (!this.isUndoing) this.undoer.setValue(settingsObj);
            this.canUndo.value = this.undoer.canUndo;
            this.canRedo.value = this.undoer.canRedo;
        }));

        loadState(this);

        // Ensure we push undo state exactly once, regardless of whether there were saved settings to restore
        this.isUndoing = false;
        this.undoer.setValue(this.settingsAsObject.value);

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
                disclaimerModalDismissed: this.disclaimerModalDismissed.value,
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

        const mediaQuery = matchMedia('(orientation: portrait)');
        const isPortrait = signal(mediaQuery.matches);
        const onQueryChange = (event: MediaQueryListEvent) => {
            isPortrait.value = event.matches;
        };
        mediaQuery.addEventListener('change', onQueryChange);
        this.isPortrait = isPortrait;
        this.cleanupCallbacks.push(() => {
            mediaQuery.removeEventListener('change', onQueryChange);
        });

        void GLOBAL_WORKER_POOL.then(pool => {
            if (pool.errorMessage) {
                this.panicMessage.value = pool.errorMessage;
                return;
            }
            const onPanic = (event: PanicEvent) => {
                this.panicMessage.value = event.message;
            };
            pool.addEventListener('panic', onPanic);
            this.cleanupCallbacks.push(() => {
                pool.removeEventListener('panic', onPanic);
            });
        });
    }

    settingsFromObject(settingsObj: SettingsObj) {
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

    async parsePreset(json: string) {
        if (!json.trimStart().startsWith('{')) {
            throw new Error('Not a JSON preset');
        }
        const settingsList = await settingsListPromise;
        const mergedSettings = JSON.parse(settingsList.parsePreset(json)) as SettingsObj;
        return mergedSettings;
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

    async initPresetsDir() {
        if (this.presetsState.presetsDir.value.state !== 'not_loaded') return;

        try {
            await navigator.storage.persist();
            const root = await navigator.storage.getDirectory();
            const presetsDirHandle = await root.getDirectoryHandle('presets', {create: true});
            const dir = new Directory(presetsDirHandle);
            // Preload the root directory
            await dir.traverse(true);
            this.presetsState.presetsDir.value = {
                state: 'loaded',
                root: {
                    dir,
                    path: '/presets',
                },
            };
        } catch (error) {
            this.presetsState.presetsDir.value = {state: 'error', error};
        }
    }

    isPresetModified(): boolean {
        const selected = this.presetsState.selectedPreset.value;
        if (!selected) return false;
        const current = this.settingsAsObject.value;
        const original = selected.originalSettings;
        for (const key in current) {
            if (current[key] !== original[key]) return true;
        }
        return false;
    }

    undo() {
        this.isUndoing = true;
        try {
            const newSettings = this.undoer.undo();
            if (newSettings) this.settingsFromObject(newSettings);
            this.canUndo.value = this.undoer.canUndo;
            this.canRedo.value = this.undoer.canRedo;
        } finally {
            this.isUndoing = false;
        }
    }

    redo() {
        this.isUndoing = true;
        try {
            const newSettings = this.undoer.redo();
            if (newSettings) this.settingsFromObject(newSettings);
            this.canUndo.value = this.undoer.canUndo;
            this.canRedo.value = this.undoer.canRedo;
        } finally {
            this.isUndoing = false;
        }
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
    settings: SettingsObj,
    resizeEnabled: boolean,
    resizeHeight: number,
    resizeFilter: ResizeFilter,
    stillImageFrameRate: number,
    mute: boolean,
    volume: number,
    renderVideoCodec: AppVideoCodec | null,
    renderVideoBitrate: number,
    renderStillImageDuration: number,
    disclaimerModalDismissed: boolean,
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
            'disclaimerModalDismissed',
        ] as const) {
            if (typeof savedState[key] !== 'undefined') {
                store[key].value = savedState[key];
            }
        }

        store.disclaimerModalOpen.value = !store.disclaimerModalDismissed.value;
    } catch (err) {
        // Swallow errors here
        // eslint-disable-next-line no-console
        console.warn('Failed to load saved app state:', err);
    }
};
