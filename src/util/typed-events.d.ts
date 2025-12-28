declare class TypedEvent<T extends string> extends Event {
    readonly type: T;
    constructor(type: T, eventInitDict?: EventInit);
}

type TypedEventListener<T> = (evt: T) => void | {
    handleEvent(object: T): void;
};

declare class TypedEventTarget<Event extends TypedEvent<string>> {
    addEventListener<T extends Event['type']>(
        type: T,
        listener: TypedEventListener<Extract<Event, {type: T}>> | null,
        options?: AddEventListenerOptions | boolean
    ): void;

    removeEventListener<T extends Event['type']>(
        type: T,
        listener: TypedEventListener<Extract<Event, {type: T}>> | null,
        options?: AddEventListenerOptions | boolean
    ): void;

    dispatchEvent<T extends Event>(
        event: T
    ): boolean;
}

export {TypedEvent, TypedEventListener, TypedEventTarget};
