import {effect, signal, Signal} from '@preact/signals';
import {useEffect, useLayoutEffect, useMemo, useRef} from 'preact/hooks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const throttle = <F extends (...args: any[]) => void>(fn: F, delay: number, debounce = false):
((...args: Parameters<F>) => void) & {cancel: () => void} => {
    let timeout: number | undefined;

    let lastExecutionTime = 0;
    const throttle = (...args: Parameters<F>) => {
        if (typeof timeout === 'number') {
            window.clearTimeout(timeout);
        }

        const now = Date.now();
        const run = () => {
            fn(...args);

            lastExecutionTime = Date.now();
        };

        if (now - lastExecutionTime >= delay && !debounce) {
            run();
        } else {
            timeout = window.setTimeout(run, delay);
        }
    };

    throttle.cancel = () => {
        if (typeof timeout === 'number') {
            window.clearTimeout(timeout);
        }
    };

    return throttle;
};

export default throttle;

export const useThrottledSignal = <T>(input: Signal<T>, delay: number, debounce = false) => {
    const throttled = useMemo(() => signal(input.peek()), [input]);
    const updateValueThrottled = useRef<(newValue: T) => void>();
    useLayoutEffect(() => {
        const newThrottleFn = throttle((newValue: T) => {
            throttled.value = newValue;
        }, delay, debounce);
        updateValueThrottled.current = newThrottleFn;
        return () => {
            newThrottleFn.cancel();
        };
    }, [input, delay, debounce, throttle]);

    useLayoutEffect(() => {
        if (updateValueThrottled.current && throttled.peek() !== input.value) {
            updateValueThrottled.current(input.value);
        }
    }, [input, input.value]);

    return throttled;
};

/**
 * Like useComputed, but throttles the actual computation.
 * Unlike useComputed, dependencies must be specified explicitly since automatic
 * tracking would require running the computation on every change.
 *
 * @param compute - Function that computes the value.
 * @param deps - Signals to watch for changes.
 * @param delay - Minimum time between computations in milliseconds.
 * @param debounce - If true, waits for `delay` ms of inactivity before computing.
 */
export const useThrottledComputed = <T>(
    compute: () => T,
    deps: Signal<unknown>[],
    delay: number,
    debounce = false,
): Signal<T> => {
    // Create output signal with initial computed value
    const output = useMemo(() => signal(compute()), []);
    const computeRef = useRef(compute);
    computeRef.current = compute;

    useEffect(() => {
        // Throttled function that performs the actual computation
        const throttledCompute = throttle(() => {
            output.value = computeRef.current();
        }, delay, debounce);

        // Subscribe to dependency signals and trigger throttled computation
        const dispose = effect(() => {
            // Read each dependency to register it with the effect
            for (const dep of deps) {
                void dep.value;
            }
            throttledCompute();
        });

        return () => {
            dispose();
            throttledCompute.cancel();
        };
    }, [delay, debounce, output, ...deps]);

    return output;
};
