import {signal, Signal} from '@preact/signals';
import {useEffect, useMemo, useRef} from 'preact/hooks';

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

            lastExecutionTime = now;
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
    useEffect(() => {
        const newThrottleFn = throttle((newValue: T) => {
            throttled.value = newValue;
        }, delay, debounce);
        updateValueThrottled.current = newThrottleFn;
        return () => {
            newThrottleFn.cancel();
        };
    }, [input, delay, debounce, throttle]);

    useEffect(() => {
        if (updateValueThrottled.current && throttled.peek() !== input.value) {
            updateValueThrottled.current(input.value);
        }
    }, [input, input.value]);

    return throttled;
};
