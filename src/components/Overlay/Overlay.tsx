import style from './style.module.scss';

import {Signal, signal} from '@preact/signals';
import {ComponentChildren, createContext} from 'preact';
import {MutableRef, useContext, useLayoutEffect, useRef} from 'preact/hooks';

// "Portal" but without multiple roots. Used to always render floating elements under a separate top-level element.
// This is a massive hack that will probably come back to bite me someday, but hey, it works.

export const OverlayContext = createContext<{
    /** Stores every child of an <Overlay> which should be rendered under the corresponding {@link OverlayProvider}. */
    children: MutableRef<ComponentChildren>[];
    /** Forces a re-render when incremented. */
    generation: Signal<number>;
} | undefined>(undefined);

/** Component which renders its children under the corresponding {@link OverlayProvider}. */
export const Overlay = ({children}: {children?: ComponentChildren}) => {
    const context = useContext(OverlayContext);
    if (!context) return null;

    // Get children as a ref so we can tell when it's changed, and also to "box" it so we can find it in the array of
    // children even if its index changes.
    const childrenRef = useRef<ComponentChildren>(children);
    // This is necessary to avoid an infinite loop. Otherwise, incrementing context.generation causes OverlayProvider to
    // rerender, which causes all child Overlays to rerender, which increments context.generation...
    if (childrenRef.current !== children) {
        childrenRef.current = children;
        context.generation.value++;
    }

    useLayoutEffect(() => {
        // On component mount, push to the list of children to be rendered and force a rerender.
        context.children.push(childrenRef);
        context.generation.value++;

        // On component dismount, remove from the list of children to be rendered and force a rerender.
        return () => {
            const refIndex = context.children.indexOf(childrenRef);
            if (refIndex !== -1) {
                context.children.splice(refIndex, 1);
                context.generation.value++;
            }
        };
    }, []);

    return null;
};

const OverlayContainerInner = () => {
    const context = useContext(OverlayContext);

    if (!context) return null;
    // Trigger a re-render
    void context.generation.value;
    if (context.children.length === 0) {
        return null;
    }
    return <div className={style.overlays}>{context.children.map(ref => ref.current)}</div>;
};

export const OverlayProvider = ({children}: {children?: ComponentChildren}) => {
    const ctx = useRef<{children: MutableRef<ComponentChildren>[]; generation: Signal<number>}>();
    if (!ctx.current) {
        ctx.current = {
            children: [],
            generation: signal(0),
        };
    }

    return (
        <OverlayContext.Provider value={ctx.current}>
            {children}
            <OverlayContainerInner />
        </OverlayContext.Provider>
    );
};
