import style from './style.module.scss';

import {MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'preact/hooks';
import {EffectPreviewMode, useAppState} from '../../app-state';
import type MediaPlayer from '../../util/media-player';
import type {FrameEvent, StateChangeEvent} from '../../util/media-player';
import {batch, Signal, useComputed, useSignal, useSignalEffect} from '@preact/signals';
import {
    CheckboxToggle,
    ImperativeSlider,
    ImperativeSpinBox,
    SelectableButton,
    Slider,
    SpinBox,
    timestampSpinboxDisplay,
    ToggleIcon,
} from '../Widgets/Widgets';
import Icon, {IconButton} from '../Icon/Icon';
import showOpenFilePicker from '../../util/file-picker';
import {useAddErrorToast} from '../Toast/Toast';
import {CSSProperties, TargetedEvent} from 'preact';
import {formatTimestamp} from '../../util/format-timestamp';
import classNames from 'clsx';
import Loader from '../Loader/Loader';
import {GLOBAL_WORKER_POOL} from '../../util/effect-worker-pool';
import saveToFile from '../../util/save-to-file';
import useMediaQuery from '../../util/use-media-query';
import useFloating from '../../util/floating';
import {ComputePositionConfig, offset, shift, size} from '@floating-ui/dom';
import {Overlay} from '../Overlay/Overlay';

const mediaPlayerModule = import('../../util/media-player');

type MediaPlayerState =
    {state: 'not_loaded'} |
    {state: 'loading', player: Promise<MediaPlayer | void>} |
    {state: 'loaded', player: MediaPlayer} |
    {state: 'error', error: Error};

const VideoPlayer = () => {
    const appState = useAppState();
    const mediaBlob = appState.mediaBlob.value;

    const mediaPlayer = useSignal<MediaPlayerState>({state: 'not_loaded'});

    useEffect(() => {
        if (mediaBlob) {
            const playerPromise = mediaPlayerModule
                .then(mediaPlayerModule => mediaPlayerModule.default)
                .then(MediaPlayer => MediaPlayer.create(mediaBlob, GLOBAL_WORKER_POOL, {
                    resizeHeight: appState.resizeHeight.value,
                    resizeFilter: appState.resizeFilter.value,
                    effectEnabled: appState.effectPreviewMode.value !== 'disabled',
                    effectSettings: appState.settingsAsObject.value,
                    outputRect: appState.previewSplitRectAsObject.value,
                }, appState.stillImageFrameRate.value))
                .then(player => {
                    mediaPlayer.value = {state: 'loaded', player};
                    return player;
                }, error => {
                    mediaPlayer.value = {state: 'error', error: error as Error};
                });
            mediaPlayer.value = {state: 'loading', player: playerPromise};
        } else {
            mediaPlayer.value = {state: 'not_loaded'};
        }

        return () => {
            if (mediaPlayer.value.state === 'loaded') {
                mediaPlayer.value.player.destroy();
            }
            if (mediaPlayer.value.state === 'loading') {
                void mediaPlayer.value.player.then(player => {
                    player?.destroy();
                });
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
                <header className={style.errorHeader}>Error loading media</header>
                <div className={style.errorBody}>{playerState.error.message}</div>
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

    const isTouch = useMediaQuery('(pointer: coarse)');

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
            <div>Drag files here or {isTouch.value ? 'tap' : 'click'} to browse files</div>
        </div>
    );
};

const FrameRateAdjuster  = ({player}: {player: MediaPlayer}) => {
    const {stillImageFrameRate} = useAppState();
    useSignalEffect(() => {
        player.input.frameRate = stillImageFrameRate.value;
        player.state = 'paused';
    });

    return <SpinBox
        value={stillImageFrameRate}
        min={1}
        max={240}
        step={1}
        smartAim={6}
        width={3}
    />;
};

const VideoInfoBar = ({player}: {player: MediaPlayer | null}) => {
    const appState = useAppState();
    const addErrorToast = useAddErrorToast();
    const mediaFile = appState.mediaBlob;

    const closeVideo = useCallback(() => {
        mediaFile.value = null;
    }, [mediaFile]);

    const copyFrame = useCallback(() => {
        if (!player) return;
        const curPlayer = player;
        (async() => {
            const blob = await player.currentFrameAsPNG();
            if (curPlayer !== player || !blob) return;
            await navigator.clipboard.write([new ClipboardItem({[blob.type]: blob})]);
        })().catch(err => addErrorToast('Failed to copy frame', err));
    }, [player, addErrorToast]);

    const saveFrame = useCallback(() => {
        if (!player) return;
        const curPlayer = player;
        (async() => {
            const blob = await player.currentFrameAsPNG();
            if (curPlayer !== player || !blob) return;
            saveToFile('frame.png', blob);
        })().catch(err => addErrorToast('Failed to save frame', err));
    }, [player, addErrorToast]);

    if (mediaFile.value === null) return null;

    return (
        <div className={style.videoInfoBar}>
            <div className={style.videoFileName}>{mediaFile.value.name}</div>
            <IconButton type="copy" title="Copy frame" onClick={copyFrame} disabled={player === null} />
            <IconButton type="download" title="Save frame" onClick={saveFrame} disabled={player === null} />
            {player && <div className={style.videoInfo}>
                <div className={style.videoResolution}>{player.width}x{player.height}</div>
                <div className={style.videoFramerate}>{
                    player.input.isStillImage ?
                        <FrameRateAdjuster player={player} /> :
                        player.frameRate.toFixed(2)
                } fps</div>
            </div>}
            <IconButton type="close" title="Close" onClick={closeVideo} />
        </div>
    );
};

const DesktopVideoControls = ({
    disabled,
    hasAudio,
    playing,
    mute,
    volume,
    zoomFit,
    zoomPercent,
    effectPreviewMode,
    playPause,
    toggleMute,
}: {
    disabled: boolean,
    hasAudio: boolean,
    playing: Signal<boolean>,
    mute: Signal<boolean>,
    volume: Signal<number>,
    zoomFit: Signal<boolean>,
    zoomPercent: Signal<number>,
    effectPreviewMode: Signal<EffectPreviewMode>,
    playPause: () => void,
    toggleMute: () => void,
}) => {
    return (
        <div className={classNames(style.playerControls, disabled && style.disabled)}>
            <div className={style.timeControls}>
                <IconButton
                    type={playing.value ? 'pause' : 'play'}
                    title={playing.value ? 'Pause' : 'Play'}
                    onClick={playPause}
                    disabled={disabled}
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
                    disabled={zoomFit.value || disabled}
                />
                <CheckboxToggle
                    label="Fit"
                    checked={zoomFit}
                    disabled={disabled}
                    title="Fit the video within the pane, up to 100% zoom"
                />
            </div>
            <div className={style.volumeControls}>
                <IconButton
                    type={mute.value ? 'speaker-mute' : 'speaker'}
                    title={mute.value ? 'Unmute' : 'Mute'}
                    onClick={toggleMute}
                    disabled={disabled || !hasAudio}
                />
                <Slider
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={disabled || !hasAudio}
                    detents={[100]}
                    className={style.volumeSlider}
                />
                <SpinBox
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={disabled || !hasAudio}
                    width={3}
                />
            </div>
            <div className={style.effectEnabled}>
                <Icon
                    type="effect"
                    title="Effect preview"
                />
                <SelectableButton currentValue={effectPreviewMode} value="enabled" disabled={disabled}>
                    Enable
                </SelectableButton>
                <SelectableButton currentValue={effectPreviewMode} value="disabled" disabled={disabled}>
                    Disable
                </SelectableButton>
                <SelectableButton currentValue={effectPreviewMode} value="split" disabled={disabled}>
                    Split
                </SelectableButton>
            </div>
        </div>
    );
};

const popupMiddleware = (): ComputePositionConfig => ({
    placement: 'top',
    middleware: [
        offset(8),
        shift({padding: 8}),
        size({
            apply({availableHeight, elements}) {
                elements.floating.style.maxHeight = `${availableHeight}px`;
            },
            padding: 24,
        }),
    ],
});

const MobileVideoControls = ({
    disabled,
    hasAudio,
    playing,
    mute,
    volume,
    zoomFit,
    zoomPercent,
    effectPreviewMode,
    playPause,
    toggleMute,
}: {
    disabled: boolean,
    hasAudio: boolean,
    playing: Signal<boolean>,
    mute: Signal<boolean>,
    volume: Signal<number>,
    zoomFit: Signal<boolean>,
    zoomPercent: Signal<number>,
    effectPreviewMode: Signal<EffectPreviewMode>,
    playPause: () => void,
    toggleMute: () => void,
}) => {
    const {reference: zoomReference, floating: zoomFloating} = useFloating(popupMiddleware);
    const zoomOpen = useSignal(false);
    let zoomSlider = null;
    if (zoomOpen.value) {
        zoomSlider = <div className={style.sliderPopup} ref={zoomFloating}>
            <Slider
                value={zoomPercent}
                min={0}
                max={800}
                step={1}
                disabled={zoomFit.value || disabled}
                vertical
                detents={[100, 125, 150, 200, 300, 400]}
                className={style.verticalSlider}
            />
            <SpinBox
                value={zoomPercent}
                min={0}
                max={800}
                step={1}
                smartAim={50}
                disabled={zoomFit.value || disabled}
                className={style.verticalSpinbox}
            />
            <CheckboxToggle
                label="Fit"
                checked={zoomFit}
                disabled={disabled}
                title="Fit the video within the pane, up to 100% zoom"
            />
        </div>;
    }

    const {reference: previewModeReference, floating: previewModeFloating} = useFloating(popupMiddleware);
    const previewModeOpen = useSignal(false);
    let previewModePopup = null;
    if (previewModeOpen.value) {
        previewModePopup = <div
            className={classNames(style.sliderPopup, style.previewModePopup)}
            ref={previewModeFloating}
        >
            <SelectableButton currentValue={effectPreviewMode} value="enabled" disabled={disabled}>
                Enable
            </SelectableButton>
            <SelectableButton currentValue={effectPreviewMode} value="disabled" disabled={disabled}>
                Disable
            </SelectableButton>
            <SelectableButton currentValue={effectPreviewMode} value="split" disabled={disabled}>
                Split
            </SelectableButton>
        </div>;
    }

    const lastOpened = useRef<'zoom' | 'previewMode'>(null);
    useSignalEffect(() => {
        if (zoomOpen.value && lastOpened.current !== 'zoom') {
            batch(() => {previewModeOpen.value = false;});
            lastOpened.current = 'zoom';
        }
        if (previewModeOpen.value && lastOpened.current !== 'previewMode') {
            batch(() => {zoomOpen.value = false;});
            lastOpened.current = 'previewMode';
        }
    });

    return (
        <div className={classNames(style.playerControls, style.mobilePlayerControls, disabled && style.disabled)}>
            <div className={style.timeControls}>
                <IconButton
                    type={playing.value ? 'pause' : 'play'}
                    title={playing.value ? 'Pause' : 'Play'}
                    onClick={playPause}
                    disabled={disabled}
                />
            </div>
            <div className={style.volumeControls}>
                <IconButton
                    type={mute.value ? 'speaker-mute' : 'speaker'}
                    title={mute.value ? 'Unmute' : 'Mute'}
                    onClick={toggleMute}
                    disabled={disabled || !hasAudio}
                />
                <Slider
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={disabled || !hasAudio}
                    detents={[100]}
                    className={style.volumeSlider}
                />
                <SpinBox
                    value={volume}
                    min={0}
                    max={125}
                    step={1}
                    disabled={disabled || !hasAudio}
                    width={3}
                />
            </div>
            <div className={style.togglableControls}>
                <ToggleIcon
                    type="search"
                    title="Zoom"
                    toggled={zoomOpen}
                    disabled={disabled}
                    innerRef={zoomReference}
                />
                <ToggleIcon
                    type="effect"
                    title="Effect preview"
                    toggled={previewModeOpen}
                    disabled={disabled}
                    innerRef={previewModeReference}
                />
            </div>
            <Overlay>
                {zoomSlider}
                {previewModePopup}
            </Overlay>
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
    useLayoutEffect(() => {
        if (!player) return;
        player.volume = mute.value ? 0 : volume.value * 0.01;
    }, [volume.value, mute.value, player]);
    const playing = useSignal(false);
    useLayoutEffect(() => {
        if (!player) return;
        const onStateChange = (event: StateChangeEvent) => {
            playing.value = event.state === 'playing';
        };
        player.addEventListener('statechange', onStateChange);
        return () => {
            player.removeEventListener('statechange', onStateChange);
        };
    }, [player]);
    useLayoutEffect(() => {
        if (!player) return;
        player.effectEnabled = effectPreviewMode.value !== 'disabled';
    }, [effectPreviewMode.value, player]);

    const mediaQuery = useMediaQuery('(width <= 40rem)');
    if (mediaQuery.value) {
        return <MobileVideoControls
            disabled={player === null}
            hasAudio={player?.hasAudio ?? false}
            playing={playing}
            mute={mute}
            volume={volume}
            zoomFit={zoomFit}
            zoomPercent={zoomPercent}
            effectPreviewMode={effectPreviewMode}
            playPause={playPause}
            toggleMute={toggleMute}
        />;
    }

    return <DesktopVideoControls
        disabled={player === null}
        hasAudio={player?.hasAudio ?? false}
        playing={playing}
        mute={mute}
        volume={volume}
        zoomFit={zoomFit}
        zoomPercent={zoomPercent}
        effectPreviewMode={effectPreviewMode}
        playPause={playPause}
        toggleMute={toggleMute}
    />;
};

const VideoScrubber = ({player}: {player: MediaPlayer}) => {
    const handleScrub = useCallback((event: TargetedEvent<HTMLInputElement, InputEvent>) => {
        void player.seek(Number(event.currentTarget.value));
    }, [player]);
    const handleSpinboxScrub = useCallback((value: number) => {
        void player.seek(value);
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
    const totalDuration = useMemo(() => {
        return player.duration === null ? '∞' : formatTimestamp(player.duration);
    }, [player]);
    const spinboxWidth = useMemo(() => {
        const formattedTimestamp = formatTimestamp(player.duration ?? (60 * 60));
        const numericLength = formattedTimestamp.replace(/[^\d]/g, '').length;
        const punctuationLength = formattedTimestamp.length - numericLength;
        return numericLength + (punctuationLength * (1 / 3));
    }, [player]);

    return (
        <div className={classNames(style.videoScrubber, 'tabular-nums')}>
            <div className={style.currentTimestamp}>
                <ImperativeSpinBox
                    value={scrubValue.value}
                    onInput={handleSpinboxScrub}
                    customDisplay={timestampSpinboxDisplay}
                    min={0}
                    max={player.duration ?? undefined}
                    step={1 / player.frameRate}
                    width={spinboxWidth}
                />
            </div>
            <ImperativeSlider
                min={0}
                max={player.duration ?? 0}
                value={scrubValue.value}
                step="any"
                onInput={handleScrub}
                className={style.scrubberSlider}
                disabled={player.duration === null}
            />
            <div
                className={classNames(style.totalDuration, player.duration === null && style.infinite)}
            >{totalDuration}</div>
        </div>
    );
};

const VideoPaneInner = ({player}: {player: MediaPlayer}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const canvasCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
        player.canvas = canvasRef.current = canvas;
    }, [player]);
    const wrapperRef = useRef<HTMLDivElement>(null);

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
    useLayoutEffect(() => {
        player.outputRect = appState.previewSplitRectAsObject.value;
    }, [appState.previewSplitRectAsObject.value]);

    const viewportSize = useRef({blockSize: 0, inlineSize: 0});
    const resizeCanvas = useCallback(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const canvasStyle: CSSProperties = {};
        if (appState.zoomFit.value) {
            let clampedWidth = canvas.width;
            let clampedHeight = canvas.height;
            if (viewportSize.current.blockSize < canvas.height) {
                clampedHeight = viewportSize.current.blockSize;
                clampedWidth = (viewportSize.current.blockSize * canvas.width) / canvas.height;
            }
            if (viewportSize.current.inlineSize < canvas.width) {
                clampedWidth = viewportSize.current.inlineSize;
                clampedHeight = (viewportSize.current.inlineSize * canvas.height) / canvas.width;
            }
            canvasStyle.width = `${clampedWidth}px`;
            canvasStyle.height = `${clampedHeight}px`;
            canvasStyle.imageRendering = '';
        } else {
            canvasStyle.width = `${appState.zoomPercent.value * 0.01 * canvas.width}px`;
            canvasStyle.height = `${appState.zoomPercent.value * 0.01 * canvas.height}px`;
            canvasStyle.imageRendering = appState.zoomPercent.value >= 200 ? 'crisp-edges' : 'auto';
        }
        Object.assign(canvas.style, canvasStyle);
    }, [canvasRef, appState.zoomFit, appState.zoomPercent]);

    const viewportRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const observer = new ResizeObserver(entries => {
            if (!entries[0]) return;

            const entry = entries[0];
            viewportSize.current = entry.contentBoxSize[0];

            resizeCanvas();
        });
        observer.observe(viewport);
        return () => {
            observer.disconnect();
        };
    }, [viewportRef.current, viewportSize, appState.zoomFit, resizeCanvas]);
    useLayoutEffect(() => {
        resizeCanvas();
    }, [appState.zoomFit.value, appState.zoomPercent.value, appState.effectPreviewMode.value === 'split']);
    useLayoutEffect(() => {
        const onCanvasResize = () => {
            resizeCanvas();
        };
        player.addEventListener('canvasresize', onCanvasResize);
        return () => {
            player.removeEventListener('canvasresize', onCanvasResize);
        };
    }, [player]);

    return (
        <div className={style.videoViewport} ref={viewportRef}>
            <div className={style.playerCanvasWrapper} ref={wrapperRef}>
                <canvas className={style.playerCanvas} ref={canvasCallbackRef} />
                {appState.effectPreviewMode.value === 'split' &&
                    <SplitBar wrapperRef={wrapperRef} />}
            </div>
        </div>
    );
};

const SplitBar = ({wrapperRef}: {wrapperRef: MutableRef<HTMLDivElement | null>}) => {
    const {previewSplitRect: previewSplitBounds} = useAppState();

    const listeners = useRef<{
        move: (event: PointerEvent) => void,
        up: (event: PointerEvent) => void,
    }>(null);
    useEffect(() => {
        return () => {
            if (listeners.current) {
                const {move, up} = listeners.current;
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            }
        };
    }, []);
    const onPointerDown = useCallback((event: TargetedEvent<HTMLDivElement, PointerEvent>) => {
        const targetBounds = event.currentTarget.getBoundingClientRect();
        const startingOffset = event.clientX - ((targetBounds.left + targetBounds.right) * 0.5);

        const onMove = (event: PointerEvent) => {
            if (!wrapperRef.current) return;
            const bounds = wrapperRef.current.getBoundingClientRect();
            const relativeX = (event.clientX - bounds.left - startingOffset) / bounds.width;
            previewSplitBounds.right.value = Math.max(0, Math.min(relativeX, 1));
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        listeners.current = {move: onMove, up: onUp};
    }, [wrapperRef]);

    return <>
        <div
            className={style.splitBar}
            style={{left: `calc(${previewSplitBounds.right.value * 100}% - 0.5rem)`}}
            onPointerDown={onPointerDown}
        />
    </>;
};

export default VideoPlayer;
