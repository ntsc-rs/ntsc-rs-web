/* eslint-disable @stylistic/comma-dangle */
import {createContext} from 'preact';
import {useContext, useId, useMemo, useRef} from 'preact/hooks';
import {Signal, useSignal} from '@preact/signals';
import type {ComponentChildren} from 'preact';
import {useLiveSignal} from '@preact/signals/utils';

export type DragItem<T = unknown> = {
    typeKey: string;
    data: T;
};

export type DragProps = {
    draggable?: boolean;
    onDragStart?: (event: DragEvent) => void;
    onDragEnd?: (event: DragEvent) => void;
};

export type DropProps = {
    onDragOver?: (event: DragEvent) => void;
    onDragEnter?: (event: DragEvent) => void;
    onDragLeave?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
};

type DragDropContextType = {
    draggedItem: Signal<DragItem | null>;
    currentDropTarget: Signal<string | null>;
};

const DragDropContext = createContext<DragDropContextType | null>(null);

export const DragDropProvider = ({children}: {children: ComponentChildren}) => {
    const draggedItem = useSignal<DragItem | null>(null);
    const currentDropTarget = useSignal<string | null>(null);

    return (
        <DragDropContext.Provider value={{draggedItem, currentDropTarget}}>
            {children}
        </DragDropContext.Provider>
    );
};

const useDragDropContext = () => {
    const ctx = useContext(DragDropContext);
    if (!ctx) throw new Error('useDraggable/useDroppable must be used within DragDropProvider');
    return ctx;
};

export type DragConfig<T> = {
    typeKey: string;
    data: T;
    disabled?: boolean;
};

export const useDraggable = <T,>({
    typeKey,
    data,
    disabled,
}: DragConfig<T>) => {
    const {draggedItem, currentDropTarget} = useDragDropContext();

    const refState = useRef({
        data,
    }).current;
    refState.data = data;

    const dragProps = useMemo<DragProps>(() => {
        const onDragStart = (event: DragEvent) => {
            if (disabled) {
                event.preventDefault();
                return;
            }
            draggedItem.value = {typeKey, data: refState.data};
            event.dataTransfer!.effectAllowed = 'move';
        };

        const onDragEnd = () => {
            draggedItem.value = null;
            currentDropTarget.value = null;
        };


        return {
            draggable: !disabled,
            onDragStart,
            onDragEnd,
        };
    }, [typeKey, refState, disabled, draggedItem, currentDropTarget]);

    const isDragging = useLiveSignal(!disabled && draggedItem.value !== null && draggedItem.value.data === data);

    return {
        dragProps,
        isDragging,
    };
};

export type Droppable =
    | {kind: 'drag', value: DragItem<unknown>}
    | {kind: 'data', value: DataTransferItemList};

export type TypedDroppable<T> = Droppable & {value: T};

export type DropConfig<T> = {
    onDrop: (item: TypedDroppable<T>) => void;
    canDropItem: (item: Droppable) => item is TypedDroppable<T>;
    disabled?: boolean;
};

export const useDroppable = <T,>({
    onDrop,
    canDropItem,
    disabled,
}: DropConfig<T>) => {
    const {draggedItem: draggedItemUntyped, currentDropTarget} = useDragDropContext();
    const draggedItem = draggedItemUntyped as Signal<DragItem<T> | null>;
    const id = useId();

    const refState = useRef({
        onDrop,
        canDropItem,
        disabled,
    }).current;
    refState.onDrop = onDrop;
    refState.canDropItem = canDropItem;
    refState.disabled = disabled;
    const currentlyDroppable = useSignal(false);

    const dropProps = useMemo<DropProps>(() => {
        const canDrop = (event: DragEvent) => {
            if (refState.disabled) return false;
            const item = draggedItem.value ?
                {kind: 'drag' as const, value: draggedItem.value} :
                {kind: 'data' as const, value: event.dataTransfer!.items};
            const canDrop = refState.canDropItem(item);
            currentlyDroppable.value = canDrop;
            return canDrop ? item : null;
        };

        const onDragOver = (event: DragEvent) => {
            if (!canDrop(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer!.dropEffect = 'move';
        };

        const onDragEnter = (event: DragEvent) => {
            if (refState.disabled) return;
            event.preventDefault();
            event.stopPropagation();
            if (canDrop(event)) {
                // Set this as the current drop target (replaces any parent)
                currentDropTarget.value = id;
            }
        };

        const onDragLeave = (event: DragEvent) => {
            if (refState.disabled) return;
            event.stopPropagation();
            // Only clear if we're still the current target and leaving to outside
            const relatedTarget = event.relatedTarget as Node | null;
            const currentTarget = event.currentTarget as Node;
            if (relatedTarget && currentTarget.contains(relatedTarget)) {
                return;
            }
            if (currentDropTarget.value === id) {
                currentDropTarget.value = null;
            }
        };

        const handleDrop = (event: DragEvent) => {
            if (refState.disabled) return;
            event.preventDefault();
            event.stopPropagation();
            currentDropTarget.value = null;
            const droppedItem = canDrop(event);
            if (droppedItem) refState.onDrop(droppedItem);
        };

        return {
            onDragOver,
            onDragEnter,
            onDragLeave,
            onDrop: handleDrop,
        };
    }, [refState]);

    const isOver = useLiveSignal(currentDropTarget.value === id && currentlyDroppable.value);

    return {
        dropProps,
        isOver,
    };
};
