import style from './style.module.scss';

import {useCallback, useEffect, useLayoutEffect, useMemo} from 'preact/hooks';
import {useAppState} from '../../app-state';
import MediaPlayer, {FrameEvent, StateChangeEvent} from '../../util/media-player';
import {useComputed, useSignal} from '@preact/signals';
import {CheckboxToggle, ImperativeSlider, SelectableButton, Slider, SpinBox} from '../Widgets/Widgets';
import Icon, {IconButton} from '../Icon/Icon';
import showOpenFilePicker from '../../util/file-picker';
import {useAddErrorToast} from '../Toast/Toast';
import {TargetedEvent} from 'preact';
import formatTimestamp from '../../util/format-timestamp';
import classNames from 'clsx';
import Loader from '../Loader/Loader';

type MediaPlayerState =
    {state: 'not_loaded'} |
    {state: 'loading'} |
    {state: 'loaded', player: MediaPlayer} |
    {state: 'error', error: Error};

const VideoPlayer = () => {
    const appState = useAppState();
    const mediaBlob = appState.mediaBlob.value;

    const mediaPlayer = useSignal<MediaPlayerState>({state: 'not_loaded'});

    useEffect(() => {
        if (mediaBlob) {
            MediaPlayer.create(mediaBlob, {
                resizeHeight: appState.resizeHeight.value,
                resizeFilter: appState.resizeFilter.value,
                effectEnabled: appState.effectPreviewMode.value === 'enabled',
                effectSettings: appState.settingsAsObject.value,
            }).then(player => {
                mediaPlayer.value = {state: 'loaded', player};
            }, error => {
                mediaPlayer.value = {state: 'error', error: error as Error};
            });
            mediaPlayer.value = {state: 'loading'};
        } else {
            mediaPlayer.value = {state: 'not_loaded'};
        }

        // TODO: this leaks memory if you switch files while the media player is loading
        return () => {
            if (mediaPlayer.value.state === 'loaded') {
                mediaPlayer.value.player.destroy();
            }
        };
    }, [mediaBlob]);

    const inner = useComputed(() => {
        const playerState = mediaPlayer.value;
        switch (playerState.state) {
            case 'not_loaded': return <MediaDropZone />;
            case 'loading': return <div class={style.loadingState}>
                <Loader />
            </div>;
            case 'loaded': return <div className={style.playerVideoPane}>
                <VideoPaneInner player={playerState.player} />
            </div>;
            case 'error': return <div class={style.error}>
                <div>
                    <header className={style.errorHeader}>Error loading media</header>
                    <div className={style.errorBody}>{playerState.error.message}</div>
                </div>
            </div>;
        }
    });

    const player = mediaPlayer.value.state === 'loaded' ? mediaPlayer.value.player : null;
    return (
        <div className={style.playerWrapper}>
            <VideoInfoBar player={player} />
            {inner.value}
            {player && <VideoScrubber player={player} /> }
            <VideoControls player={player} />
        </div>
    );
};

const hasFiles = (event: DragEvent): event is DragEvent & {dataTransfer: DataTransfer & {files: FileList}} => {
    // For most drag event types, dataTransfer.files will not be populated, but dataTransfer.items is
    if (!event.dataTransfer?.items) return false;
    for (const item of event.dataTransfer.items) {
        if (item.kind === 'file') {
            return true;
        }
    }
    return false;
};

const MediaDropZone = () => {
    const appState = useAppState();
    const addErrorToast = useAddErrorToast();
    const isDragging = useSignal(false);

    const onDragEnter = useCallback((event: DragEvent) => {
        isDragging.value = true;
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
    }, []);
    const onDragOver = useCallback((event: DragEvent) => {
        isDragging.value = true;
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
    }, []);
    const onDrop = useCallback((event: DragEvent) => {
        isDragging.value = false;
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer.files?.[0]) {
            appState.mediaBlob.value = event.dataTransfer.files[0];
        }
    }, []);
    const onDragLeave = useCallback((event: DragEvent) => {
        isDragging.value = false;
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    const pickFiles = useCallback(() => {
        showOpenFilePicker({}).then(files => {
            if (files?.[0]) {
                appState.mediaBlob.value = files[0];
            }
        }, err => {
            addErrorToast('Error loading media', err);
        });
    }, []);

    return (
        <div
            className={classNames(style.mediaDropZone, isDragging.value && style.dragging)}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
            onClick={pickFiles}

        >
            <header>No media loaded</header>
            <div>Drag files here or click to browse files</div>
        </div>
    );
};

const VideoInfoBar = ({player}: {player: MediaPlayer | null}) => {
    const appState = useAppState();
    const mediaFile = appState.mediaBlob;

    const closeVideo = useCallback(() => {
        mediaFile.value = null;
    }, []);

    if (mediaFile.value === null) return null;

    return (
        <div className={style.videoInfoBar}>
            <div className={style.videoFileName}>{mediaFile.value.name}</div>
            {player && <div className={style.videoInfo}>
                <div className={style.videoResolution}>{player.width}x{player.height}</div>
                <div className={style.videoFramerate}>{player.frameRate.toFixed(2)} fps</div>
            </div>}
            <IconButton type="close" title="Close" onClick={closeVideo} />
        </div>
    );
};

const VideoControls = ({player}: {player: MediaPlayer | null}) => {
    const {mute, volume, zoomFit, zoomPercent, effectPreviewMode} = useAppState();
    const playPause = useCallback(() => {
        if (!player) return;
        player.state = player.state === 'paused' ? 'playing' : 'paused';
    }, [player]);
    const toggleMute = useCallback(() => {
        mute.value = !mute.value;
    }, [mute]);
    useEffect(() => {
        if (!player) return;
        player.volume = mute.value ? 0 : volume.value * 0.01;
    }, [volume.value, mute.value, player]);
    const playing = useSignal(false);
    useEffect(() => {
        if (!player) return;
        const onStateChange = (event: StateChangeEvent) => {
            playing.value = event.state === 'playing';
        };
        player.addEventListener('statechange', onStateChange);
        return () => {
            player.removeEventListener('statechange', onStateChange);
        };
    }, [player]);
    useEffect(() => {
        if (!player) return;
        player.effectEnabled = effectPreviewMode.value === 'enabled';
    }, [effectPreviewMode.value, player]);

    return (
        <div className={style.playerControls}>
            <div className={style.timeControls}>
                <IconButton
                    type={playing.value ? 'pause' : 'play'}
                    title={playing.value ? 'Pause' : 'Play'}
                    onClick={playPause}
                    disabled={player === null}
                />
            </div>
            <div className={style.zoomControls}>
                <Icon
                    type="search"
                    title="Zoom"
                />
                <SpinBox
                    value={zoomPercent}
                    min={0}
                    max={800}
                    step={1}
                    smartAim={50}
                    disabled={zoomFit.value || player === null}
                />
                <CheckboxToggle
                    label="Fit"
                    checked={zoomFit}
                    disabled={player === null}
                    title="Fit the video within the pane, up to 100% zoom"
                />
            </div>
            <div className={style.volumeControls}>
                <IconButton
                    type={mute.value ? 'speaker-mute' : 'speaker'}
                    title={mute.value ? 'Unmute' : 'Mute'}
                    onClick={toggleMute}
                    disabled={player === null || !player.hasAudio}
                />
                <Slider
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={player === null || !player.hasAudio}
                />
                <SpinBox
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={player === null || !player.hasAudio}
                />
            </div>
            <div className={style.effectEnabled}>
                <Icon
                    type="effect"
                    title="Effect preview"
                />
                <SelectableButton currentValue={effectPreviewMode} value="enabled">
                    Enable
                </SelectableButton>
                <SelectableButton currentValue={effectPreviewMode} value="disabled">
                    Disable
                </SelectableButton>
            </div>
        </div>
    );
};

const VideoScrubber = ({player}: {player: MediaPlayer}) => {
    const handleScrub = useCallback((event: TargetedEvent<HTMLInputElement, InputEvent>) => {
        void player.seek(Number(event.currentTarget.value));
    }, [player]);
    const scrubValue = useSignal(0);
    useLayoutEffect(() => {
        const onFrame = (event: FrameEvent) => {
            scrubValue.value = event.frameTimestamp;
        };
        player.addEventListener('frame', onFrame);
        return () => {
            player.removeEventListener('frame', onFrame);
        };
    }, [player, scrubValue]);
    const currentTimestamp = useComputed(() => {
        return formatTimestamp(scrubValue.value);
    });
    const totalDuration = useMemo(() => {
        return formatTimestamp(player.duration);
    }, [player]);

    return (
        <div className={classNames(style.videoScrubber, 'tabular-nums')}>
            <div className={style.currentTimestamp}>{currentTimestamp.value}</div>
            <ImperativeSlider
                min={0}
                max={player.duration}
                value={scrubValue.value}
                step="any"
                onInput={handleScrub}
                className={style.scrubberSlider}
            />
            <div className={style.totalDuration}>{totalDuration}</div>
        </div>
    );
};

const VideoPaneInner = ({player}: {player: MediaPlayer}) => {
    const canvasCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
        player.canvas = canvas;
    }, [player]);

    const appState = useAppState();
    // This has to be a useLayoutEffect to avoid a flash of incorrectly-sized video
    useLayoutEffect(() => {
        player.resizeHeight = appState.resizeEnabled.value ? appState.resizeHeight.value : null;
    }, [appState.resizeEnabled.value, appState.resizeHeight.value]);
    useLayoutEffect(() => {
        player.resizeFilter = appState.resizeFilter.value;
    }, [appState.resizeFilter.value]);
    useLayoutEffect(() => {
        player.effectSettings = appState.settingsAsObject.value;
    }, [appState.settingsAsObject.value]);

    const zoomStyle = useMemo(() => {
        if (appState.zoomFit.value) {
            return {
                maxWidth: '100%',
                maxHeight: '100%',
            };
        }

        const zoomWidth = player.width * appState.zoomPercent.value * 0.01;
        const zoomHeight = player.height * appState.zoomPercent.value * 0.01;

        return {
            width: `${zoomWidth}px`,
            height: `${zoomHeight}px`,
            imageRendering: appState.zoomPercent.value >= 200 ? 'crisp-edges' : 'auto',
        };
    }, [appState.zoomFit.value, appState.zoomPercent.value, player]);

    return (
        <canvas className={style.playerCanvas} ref={canvasCallbackRef} style={zoomStyle} />
    );
};

export default VideoPlayer;
