import style from './style.module.scss';

import {AppVideoCodec, useAppState} from '../../app-state';
import {Button, Dropdown, SpinBox, timestampSpinboxDisplay} from '../Widgets/Widgets';
import {batch, useComputed, useSignal} from '@preact/signals';
import {useCallback, useLayoutEffect} from 'preact/hooks';
import {SliderWithSpinBox} from '../SettingsList/SettingsList';
import type {RenderJobState} from '../../util/render-job';
import {formatTimestamp, formatTimestampHuman} from '../../util/format-timestamp';
import Icon, {IconButton} from '../Icon/Icon';
import {Motif} from '../../util/motif';
import classNames from 'clsx';
import {RenderJobLike} from '../../util/opfs-render-jobs';
import {useAddErrorToast} from '../Toast/Toast';
import saveToFile from '../../util/save-to-file';
import formatFileSize from '../../util/format-file-size';
import {extensionForCodec} from '../../util/extension-for-codec';
import Loader from '../Loader/Loader';

const renderJobPromise = import('../../util/render-job');

type PaneState =
    | {state: 'loading'}
    | {
        state: 'loaded',
        dropdownOptions: {id: AppVideoCodec, name: string}[]
    }
    | {state: 'error', error: unknown};

const hasDirectFSSupport = 'showSaveFilePicker' in window;

const ntscified = (sourceFileName: string, videoCodec: AppVideoCodec) => {
    const fileStub = sourceFileName.replace(/\..+/, '') + '_ntsc';
    return `${fileStub}.${extensionForCodec(videoCodec)}`;
};

const RenderJobComponent = ({job, onRemove}: {job: RenderJobLike, onRemove: (job: RenderJobLike) => void}) => {
    const progress = useSignal({loaded: 0, total: 0});
    const eta = useSignal<number | null>(null);
    const state = useSignal<RenderJobState>(job.state);
    // useEffect will drop events
    useLayoutEffect(() => {
        const onProgress = (event: ProgressEvent) => {
            batch(() => {
                progress.value = {loaded: event.loaded, total: event.total};
                eta.value = typeof job.eta === 'number' ? Math.ceil(job.eta) : null;
            });
        };
        const onStateChange = () => {
            state.value = job.state;
        };
        job.addEventListener('progress', onProgress);
        job.addEventListener('statechange', onStateChange);
        return () => {
            job.removeEventListener('progress', onProgress);
            job.removeEventListener('statechange', onStateChange);
        };
    }, [job]);

    const cancel = useCallback(() => {
        void job.cancel();
    }, [job]);

    const remove = useCallback(() => {
        onRemove(job);
    }, [job]);

    const downloadRender = useCallback(() => {
        if (job.state.state !== 'completed' || !job.state.file) return;
        saveToFile(ntscified(job.sourceFileName, job.videoCodec), job.state.file);
    }, [job]);

    let renderJobStatus;
    switch (state.value.state) {
        case 'waiting':
        case 'rendering':
            renderJobStatus = <>
                <progress value={progress.value.loaded} max={progress.value.total} />
                <div className={classNames(style.progressTimestamp, 'tabular-nums')}>
                    {formatTimestamp(progress.value.loaded)} / {formatTimestamp(progress.value.total)}
                </div>
                <div className={classNames(style.eta, 'tabular-nums')}>
                    {state.value.state === 'waiting' ?
                        'Starting...' :
                        eta.value ?
                            `${formatTimestampHuman(eta.value)} remaining` :
                            'Calculating ETA'}
                </div>
            </>;
            break;
        case 'completed':
            renderJobStatus = <>
                <div className={style.statusLine}>
                    <Icon type='check' motif={Motif.SUCCESS} title='' />
                    <div className={classNames(style.statusLineText, 'tabular-nums')}>
                        Completed in {formatTimestamp(state.value.time - job.startTime)}
                    </div>
                </div>
                {job.isOPFS && <div className={style.downloadRender}>
                    <Button onClick={downloadRender}><Icon type="download" title="" />Download</Button>
                    {state.value.file?.size &&
                        <div className={style.downloadSize}>{formatFileSize(state.value.file?.size)}</div>}
                </div>}
            </>;
            break;
        case 'cancelled':
            renderJobStatus = <div className={style.statusLine}>
                <Icon type='cancel' motif={Motif.MONOCHROME} title='' />
                <div className={style.statusLineText}>
                    Cancelled
                </div>
            </div>;
            break;
        case 'error':
            renderJobStatus = <>
                <div className={style.statusLine}>
                    <Icon type='error' motif={Motif.ERROR} title='' />
                    <div className={style.statusLineText}>Failed</div>
                </div>
                <div className={style.renderJobError}>
                    {state.value.error instanceof Error ? state.value.error.message : String(state.value.error)}
                </div>
            </>;
            break;
    }

    return (
        <div className={style.renderJob}>
            <div className={style.renderJobHeader}>
                <header className={style.renderJobName}>
                    {job.isOPFS ? job.sourceFileName : job.destination.name}
                </header>
                {
                    state.value.state === 'rendering' || state.value.state === 'waiting' ?
                        <IconButton type='cancel' title='Cancel' onClick={cancel} /> :
                        <IconButton type='close' title='Remove' onClick={remove} />
                }
            </div>
            {renderJobStatus}
        </div>
    );
};

const RenderJobList = () => {
    const appState = useAppState();
    const addErrorToast = useAddErrorToast();

    const removeJob = useCallback((job: RenderJobLike) => {
        appState.removeRenderJob(job).then(() => {}, err => addErrorToast('Error removing render job', err));
    }, [appState]);
    const jobs = useComputed(() => {
        switch (appState.renderJobs.value.state) {
            case 'loading': return null;
            case 'error': return String(appState.renderJobs.value.error);
            case 'loaded': return appState.renderJobs.value.jobs.value
                .map(job => <RenderJobComponent job={job} onRemove={removeJob} key={job} />);
        }
    });

    return (
        <div className={style.renderJobs}>
            {jobs}
        </div>
    );
};

const RenderSettingsPane = () => {
    const appState = useAppState();
    const addErrorToast = useAddErrorToast();

    const paneState = useSignal<PaneState>({state: 'loading'});
    useLayoutEffect(() => {
        renderJobPromise.then(imported => imported.supportedCodecsForVideo)
            .then(codecs => {
                const dropdownOptions = [];
                if (codecs.has('avc')) dropdownOptions.push({
                    id: 'avc', name: 'H.264 (MP4)',
                } as const);
                if (codecs.has('vp9')) dropdownOptions.push({
                    id: 'vp9', name: 'VP9 (WebM)',
                } as const);
                if (codecs.has('av1')) dropdownOptions.push({
                    id: 'av1', name: 'AV1 (WebM)',
                } as const);
                if (codecs.has('vp8')) dropdownOptions.push({
                    id: 'vp8', name: 'VP8 (WebM)',
                } as const);
                paneState.value = {
                    state: 'loaded',
                    dropdownOptions,
                };
            }, error => {
                paneState.value = {state: 'error', error};
            });
    }, []);
    const curState = paneState.value;

    const renderDirectlyToFile = useCallback(() => {
        const mediaBlob = appState.mediaBlob.value;
        if (!appState.renderVideoCodec.value || !mediaBlob) return;
        window.showSaveFilePicker({
            suggestedName: ntscified(mediaBlob.name, appState.renderVideoCodec.value),
            startIn: 'videos',
            id: 'save-video',
        }).then(handle => {
            return appState.addRenderJob(handle, mediaBlob, false);
        }, err => {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // The user just closed the dialog
                return;
            }
            addErrorToast('Failed to create render job', err);
        });
    }, [appState]);

    const renderToOPFS = useCallback(() => {
        const mediaBlob = appState.mediaBlob.value;
        if (!appState.renderVideoCodec.value || !mediaBlob) return;

        appState.addOPFSRenderJob(mediaBlob).catch(err => addErrorToast('Error creating render job', err));
    }, [appState]);

    const hasMedia = appState.mediaBlob.value;

    if (curState.state !== 'loaded') {
        return <div className={style.loader}>
            <Loader />
        </div>;
    }

    if (curState.dropdownOptions.length === 0) {
        return <div className={style.noCodecsSupported}>
            <p>
                This web browser does not support encoding videos.
            </p>
            <p>
                Try another browser.
            </p>
        </div>;
    }

    return (
        <div className={style.renderPaneInner}>
            <div className={style.renderSettings}>
                <div className={style.codecSettings}>
                    <div className={style.setting}>
                        <Dropdown
                            value={appState.renderVideoCodec}
                            options={curState.dropdownOptions}
                        />
                        <div className={style.settingLabel}>Codec</div>
                    </div>
                    <div className={style.setting}>
                        <SliderWithSpinBox
                            min={1}
                            max={50}
                            step={1}
                            value={appState.renderVideoBitrate}
                        />
                        <div className={style.settingLabel}>Bitrate (Mbps)</div>
                    </div>
                    {/*
                      * TODO: ideally we'd have access to the WrappedInput here so we could just check `isStillImage`
                      * instead of duplicating the check
                      */}
                    {appState.mediaBlob.value?.type.startsWith('image/') &&
                        <div className={style.setting}>
                            <SpinBox
                                value={appState.renderStillImageDuration}
                                min={1 / appState.stillImageFrameRate.value}
                                customDisplay={timestampSpinboxDisplay}
                            />
                            <div className={style.settingLabel}>Duration</div>
                        </div>
                    }

                </div>
                <div className={style.renderButtons}>
                    <Button
                        disabled={!(hasDirectFSSupport && hasMedia)}
                        title={
                            hasDirectFSSupport ? undefined :
                                'This feature is only available in Chrome-based browsers.'
                        }
                        onClick={renderDirectlyToFile}
                    >Render to file...</Button>
                    <Button disabled={!hasMedia} onClick={renderToOPFS}>Render</Button>
                </div>
            </div>
            <RenderJobList />
        </div>
    );
};

export default RenderSettingsPane;
