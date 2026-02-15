import {ReadonlySignal, signal, Signal} from '@preact/signals';
import {useLayoutEffect, useRef} from 'preact/hooks';

const useMediaQuery = (query: string): ReadonlySignal<boolean> => {
    const matches = useRef<Signal<boolean>>();
    if (!matches.current) {
        matches.current = signal(matchMedia(query).matches);
    }

    useLayoutEffect(() => {
        const mediaQuery = matchMedia(query);
        matches.current!.value = mediaQuery.matches;

        const onChange = () => {
            matches.current!.value = mediaQuery.matches;
        };
        mediaQuery.addEventListener('change', onChange);
        return () => {
            mediaQuery.removeEventListener('change', onChange);
        };
    }, [query]);

    return matches.current;
};

export default useMediaQuery;
