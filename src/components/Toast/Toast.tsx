import style from './style.module.scss';

import {ComponentChildren, FunctionComponent, createContext} from 'preact';
import {Signal, signal, useComputed, useSignal} from '@preact/signals';
import {useCallback, useContext, useLayoutEffect, useRef, useState} from 'preact/hooks';
import classNames from 'clsx';

import FakeImmutable from '../../util/fake-immutable';
import {Motif} from '../../util/motif';

import {Overlay} from '../Overlay/Overlay';
import Icon, {IconButton} from '../Icon/Icon';

type ToastInnerComponent = FunctionComponent<{
    closeToast: () => void;
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
}> | Exclude<ComponentChildren, Function>;

type ToastInnerComponentHack = FunctionComponent<{
    closeToast: () => void;
}> | Exclude<ComponentChildren, object>;

type ToastCtxTy = {
    toasts: Signal<FakeImmutable<{inner: ComponentChildren}[]>>;
    addToast: (options: AddToastOptions) => void;
};

const ToastContext = createContext<ToastCtxTy | undefined>(undefined);

const Toast = ({children, toastRef, closeToast, showCloseButton, timeout, motif = Motif.PRIMARY, title}: {
    children?: ComponentChildren;
    toastRef: (elem: HTMLDivElement | null) => void;
    closeToast: () => void;
    showCloseButton: boolean;
    timeout?: number;
    motif?: Motif;
    title?: ComponentChildren;
}) => {

    let iconType, iconTitle;
    switch (motif) {
        case Motif.SUCCESS:
            iconType = 'check' as const;
            iconTitle = 'Success' as const;
            break;
        case Motif.WARNING:
            iconType = 'warning' as const;
            iconTitle = 'Warning' as const;
            break;
        case Motif.ERROR:
            iconType = 'error' as const;
            iconTitle = 'Error' as const;
            break;
    }

    useLayoutEffect(() => {
        if (typeof timeout === 'number') {
            const timeoutId = setTimeout(closeToast, timeout);
            return () => clearTimeout(timeoutId);
        }
    }, []);

    return (
        <div className={style.toastWrapper} ref={toastRef}>
            <div className={classNames(style.toast, {
                [style.primary]: motif === Motif.PRIMARY,
                [style.success]: motif === Motif.SUCCESS,
                [style.warning]: motif === Motif.WARNING,
                [style.error]: motif === Motif.ERROR,
            })}>
                <div className={style.toastRow}>
                    {motif === Motif.PRIMARY ?
                        null :
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                        <Icon type={iconType!} title={iconTitle!} className={style.toastIcon} />}
                    {typeof title === 'undefined' || title === null ?
                        <div className={style.toastContents}>
                            {children}
                        </div> :
                        <div className={classNames(style.toastTitle, typeof title !== 'object' && style.plain)}>
                            {title}
                        </div>
                    }
                    {showCloseButton && <IconButton
                        type='close'
                        title='Close'
                        onClick={closeToast}
                        className={style.toastIcon}
                    />}
                </div>
                {typeof title === 'undefined' || title === 'null' ?
                    null :
                    <div className={classNames(style.toastContents, style.separateContents)}>
                        {children}
                    </div>}
                {typeof timeout === 'number' &&
                    <div className={style.timeoutBar} style={{animationDuration: `${timeout}ms`}} />}
            </div>
        </div>
    );
};

const ToastDisplay = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('ToastDisplay must be placed under a ToastProvider');

    const toasts = useComputed(() => context.toasts.value.value.map(t => t.inner));

    return (
        <Overlay>
            <div className={style.toastContainer}>
                {toasts}
            </div>
        </Overlay>
    );
};

export type AddToastOptions = Partial<{
    motif: Motif;
    showCloseButton: boolean;
    timeout: number;
}> & (
    {title: ToastInnerComponent; contents?: ToastInnerComponent} |
    {title?: ToastInnerComponent; contents: ToastInnerComponent}
);

export const useAddToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useAddToast requires a ToastProvider');

    return useCallback((options: AddToastOptions) => {
        context.addToast(options);
    }, [context]);
};

export const useAddErrorToast = () => {
    const addToast = useAddToast();

    return useCallback((title: string, error: unknown) => {
        addToast({
            motif: Motif.ERROR,
            title,
            contents: <>
                <div className={style.errorMessage}>{String(error)}</div>
                {typeof error === 'object' && error !== null && 'stack' in error ?
                    <div className={style.errorStack}>{(error as Error).stack}</div> :
                    null}
            </>,
        });
    }, []);
};

const ToastPlaceholder = ({height: initialHeight, onTransitionEnd}: {height: number; onTransitionEnd: () => void}) => {
    const [height, setHeight] = useState(`${initialHeight}px`);
    const node = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        // Force reflow to start the animation and then immediately set height to 0 so it transitions properly
        void node.current?.scrollTop;
        setHeight('0');
    }, []);

    return (
        <div
            className={style.toastPlaceholder}
            style={{minHeight: height}}
            onTransitionEnd={onTransitionEnd}
            ref={node}
        />
    );
};

export const ToastProvider = ({children}: {children?: ComponentChildren}) => {
    const toastsSignal = useSignal(FakeImmutable.create([] as {inner: ComponentChildren}[]));
    const ctx = useRef<ToastCtxTy | undefined>(undefined);
    const idCounter = useRef(0);

    const addToast = useCallback((options: AddToastOptions) => {
        let ref: HTMLDivElement | null = null;
        const id = idCounter.current++;

        const updateRef = (elem: HTMLDivElement | null) => {
            ref = elem;
        };

        const transformOffset = signal(0);

        const closeToast = () => {
            toastsSignal.value = toastsSignal.value.update(toasts => {
                const toastIndex = toasts.indexOf(box);
                if (toastIndex === -1) return;

                const removedHeight = ref?.getBoundingClientRect()?.height ?? 0;

                const onTransitionEnd = () => {
                    toastsSignal.value = toastsSignal.value.update(toasts => {
                        // We need to calculate the index again as an earlier toast could've been removed during the
                        // transition.
                        const toastIndex = toasts.indexOf(box);
                        if (toastIndex === -1) return;
                        toasts.splice(toastIndex, 1);
                        return toasts;
                    });
                };

                const toastPlaceholder = <ToastPlaceholder
                    key={id}
                    height={removedHeight}
                    onTransitionEnd={onTransitionEnd}
                />;
                toasts[toastIndex].inner = toastPlaceholder;

                return toasts;
            });
        };

        const ToastTitle = options.title as ToastInnerComponentHack;
        const ToastContents = options.contents as ToastInnerComponentHack;

        const box = {
            inner: <Toast
                key={id}
                toastRef={updateRef}
                motif={options.motif}
                showCloseButton={options.showCloseButton ?? true}
                timeout={options.timeout}
                closeToast={closeToast}
                title={typeof ToastTitle === 'function' ? <ToastTitle closeToast={closeToast} /> : ToastTitle}
            >
                {typeof ToastContents === 'function' ? <ToastContents closeToast={closeToast} /> : ToastContents}
            </Toast>,
            transformOffset,
        };

        toastsSignal.value = toastsSignal.value.update(toasts => {
            toasts.push(box);
            return toasts;
        });
    }, []);

    if (!ctx.current) {
        ctx.current = {
            toasts: toastsSignal,
            addToast,
        };
    }

    return (
        <ToastContext.Provider value={ctx.current}>
            <ToastDisplay />
            {children}
        </ToastContext.Provider>
    );
};
