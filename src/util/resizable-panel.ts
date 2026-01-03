import {Signal, useSignal} from '@preact/signals';
import {useCallback, useRef} from 'preact/hooks';

export const useResizablePanel = (
    initialSize: number,
    minSize: number,
    maxSize: number,
    edge: 'top' | 'bottom' | 'left' | 'right',
):  {
    resizerRef: (element: HTMLElement | null) => void;
    panelRef: (element: HTMLElement | null) => void;
    panelSize: Signal<number>;
} => {
    const panelSize = useSignal(initialSize);
    const ac = useRef<AbortController>(null);
    const panel = useRef<HTMLElement | null>(null);
    const panelRef = useCallback((element: HTMLElement | null) => {
        panel.current = element;
    }, [panelSize]);

    const refCallback = useCallback((element: HTMLElement | null) => {
        const isVertical = edge === 'top' || edge === 'bottom';
        if (ac.current) {
            ac.current.abort();
            ac.current = null;
        }
        if (!element) return;
        const abortController = new AbortController();
        ac.current = abortController;
        let onMouseMove: (event: MouseEvent) => void, onMouseUp: (event: MouseEvent) => void;
        const onMouseDown = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const startPos = isVertical ? event.clientY : event.clientX;
            const rect = panel.current?.getBoundingClientRect();
            if (!rect) return;
            const startSize = isVertical ? rect.height : rect.width;
            onMouseMove = (moveEvent: MouseEvent) => {
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                let delta = (isVertical ? moveEvent.clientY : moveEvent.clientX) - startPos;
                if (edge === 'top' || edge === 'left') delta *= -1;
                const newSize = startSize + delta;
                if (newSize >= minSize && newSize <= maxSize) {
                    panelSize.value = newSize;
                }
            };
            onMouseUp = () => {
                document.removeEventListener('pointermove', onMouseMove);
                document.removeEventListener('pointerup', onMouseUp);
                document.removeEventListener('pointerleave', onMouseUp);
            };
            document.addEventListener('pointermove', onMouseMove, {signal: abortController.signal});
            document.addEventListener('pointerup', onMouseUp, {signal: abortController.signal});
            document.addEventListener('pointerleave', onMouseUp, {signal: abortController.signal});
        };

        if (element) {
            element.addEventListener('pointerdown', onMouseDown, {signal: abortController.signal});
        }
    }, [minSize, maxSize, panelSize, edge]);

    return {
        resizerRef: refCallback,
        panelRef,
        panelSize,
    };
};

export default useResizablePanel;
