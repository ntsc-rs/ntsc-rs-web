import style from './style.module.scss';

import {AppVideoCodec, useAppState} from '../../app-state';
import {Button, Dropdown} from '../Widgets/Widgets';
import {batch, useSignal} from '@preact/signals';
import {useCallback, useLayoutEffect} from 'preact/hooks';
import {SliderWithSpinBox} from '../SettingsList/SettingsList';
import RenderJob, {extensionForCodec, RenderJobState, supportedCodecsForVideo} from '../../util/render-job';
import {formatTimestamp, formatTimestampHuman} from '../../util/format-timestamp';
import Icon, {IconButton} from '../Icon/Icon';
import {Motif} from '../../util/motif';
import classNames from 'clsx';

type PaneState =
    | {state: 'loading'}
    | {
        state: 'loaded',
        dropdownOptions: {id: AppVideoCodec, name: string}[]
    }
    | {state: 'error', error: unknown};

const hasDirectFSSupport = 'showSaveFilePicker' in window;

const RenderJobComponent = ({job, onRemove}: {job: RenderJob, onRemove: (job: RenderJob) => void}) => {
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

    let renderJobStatus;
    switch (state.value.state) {
        case 'waiting':
            renderJobStatus = 'Starting...';
            break;
        case 'rendering':
            renderJobStatus = <>
                <progress value={progress.value.loaded} max={progress.value.total} />
                <div className={classNames(style.progressTimestamp, 'tabular-nums')}>
                    {formatTimestamp(progress.value.loaded)} / {formatTimestamp(progress.value.total)}
                </div>
                <div className={classNames(style.eta, 'tabular-nums')}>
                    {eta.value ? `${formatTimestampHuman(eta.value)} remaining` : 'Calculating ETA'}
                </div>
            </>;
            break;
        case 'completed':
            renderJobStatus = <div className={style.statusLine}>
                <Icon type='check' motif={Motif.SUCCESS} title='' />
                <div className={classNames(style.statusLineText, 'tabular-nums')}>
                    Completed in {formatTimestamp(state.value.time - job.startTime)}
                </div>
            </div>;
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
                {<header className={style.renderJobName}>{job.fileName}</header>}
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

    const removeJob = useCallback((job: RenderJob) => {
        appState.removeRenderJob(job);
    }, [appState]);

    return (
        <div className={style.renderJobs}>
            {appState.renderJobs.value.map(job => <RenderJobComponent job={job} onRemove={removeJob} />)}
        </div>
    );
};

const RenderSettingsPane = () => {
    const appState = useAppState();

    const paneState = useSignal<PaneState>({state: 'loading'});
    useLayoutEffect(() => {
        supportedCodecsForVideo.then(codecs => {
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
    if (curState.state !== 'loaded') {
        return <div>Loading...</div>;
    }

    const renderDirectlyToFile = useCallback(() => {
        let fileStub = 'output';
        if (appState.mediaBlob.value) {
            const fileName = appState.mediaBlob.value.name;
            fileStub = fileName.replace(/\..+/, '') + '_ntsc';
        }
        if (!appState.renderVideoCodec.value) return;
        window.showSaveFilePicker({
            suggestedName: `${fileStub}.${extensionForCodec(appState.renderVideoCodec.value)}`,
            startIn: 'videos',
            id: 'save-video',
        }).then(handle => {
            appState.addRenderJob(handle, handle.name);
        }, () => {
            // This is an AbortError; the user just closed the dialog
        });
    }, [appState]);

    const hasMedia = appState.mediaBlob.value;

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
                    <Button disabled={!hasMedia}>Render</Button>
                </div>
            </div>
            <RenderJobList />
        </div>
    );
};

export default RenderSettingsPane;
