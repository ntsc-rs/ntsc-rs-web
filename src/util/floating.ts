import {RefCallback} from 'preact';
import {useCallback, useLayoutEffect, useRef} from 'preact/hooks';
import {ComputePositionConfig, autoUpdate, computePosition} from '@floating-ui/dom';

/**
 * Hook to interface with the floating-ui library for positioning elements.
 * @param options The floating-ui positioning options (e.g. middleware, placement).
 * @returns Callback refs for the reference and floating elements.
 */
const useFloating = <T extends HTMLElement, U extends HTMLElement>(
    options?: () => Partial<ComputePositionConfig>,
): {reference: RefCallback<T>; floating: RefCallback<U>} => {
    const autoUpdateCleanup = useRef<() => void>(() => {});

    const referenceRef = useRef<T | null>(null);
    const referenceCallback = useCallback((newReference: T | null) => {
        referenceRef.current = newReference;
        autoUpdateCleanup.current();

        if (floatingRef.current !== null && newReference !== null) {
            autoUpdateCleanup.current = autoUpdate(newReference, floatingRef.current, onUpdate, {animationFrame: true});
        }
    }, []);

    const floatingRef = useRef<U | null>(null);
    const floatingCallback = useCallback((newFloating: U | null) => {
        floatingRef.current = newFloating;
        autoUpdateCleanup.current();

        if (newFloating !== null && referenceRef.current !== null) {
            autoUpdateCleanup.current = autoUpdate(referenceRef.current, newFloating, onUpdate, {animationFrame: true});
        }
    }, []);

    const onUpdate = useCallback(() => {
        if (!referenceRef.current || !floatingRef.current) return;
        const floating = floatingRef.current;
        void computePosition(referenceRef.current, floatingRef.current, options?.()).then(({x, y}) => {
            floating.style.left = `${x}px`;
            floating.style.top = `${y}px`;
        });
    }, []);

    useLayoutEffect(() => {
        return () => autoUpdateCleanup.current();
    }, []);

    return {reference: referenceCallback, floating: floatingCallback};
};

export default useFloating;
