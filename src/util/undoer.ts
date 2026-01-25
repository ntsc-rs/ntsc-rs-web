type UndoNode<T> = {prev: UndoNode<T> | null, next: UndoNode<T> | null, value: T};

export default class Undoer<T> {
    private readonly idleTime: number;
    private readonly maxLen: number;

    /**
     * ID for the idle timeout. After `this.idleTime` ms with no updates, we treat the current value as "committed", and
     * the next time `setValue` is called, it will add a node to the undo chain instead of overwriting the current one.
     * If this ID is nonzero, it means we're not idle yet.
     */
    private timeoutId = 0;
    /** Undo queue, managed as a doubly-linked list. */
    private undos: UndoNode<T> | null = null;
    /** Oldest undo in the queue; kept for trimming the queue to `maxLen`. */
    private oldestUndo: UndoNode<T> | null = null;
    /** Number of nodes in the queue. */
    private len = 0;
    /** Number of nodes following the one that `this.undos` points to. */
    private numRedos = 0;

    constructor(idleTime: number, maxLen: number) {
        this.idleTime = idleTime;
        this.maxLen = Math.max(maxLen, 1);
    }

    setValue(value: T) {
        if (this.timeoutId && this.undos) {
            // There *is* a pending timeout; reset it and overwrite the pending value
            window.clearTimeout(this.timeoutId);
            this.undos.value = value;
        } else {
            const prev = this.undos;
            // There is *not* a pending timeout; push a new value to the queue. This value will be overwritten by
            // subsequent setValue calls until the timeout completes.
            const nextUndo = {prev, next: null, value};
            if (prev) prev.next = nextUndo;
            if (!this.oldestUndo) this.oldestUndo = nextUndo;
            this.undos = nextUndo;

            // We cut off the redos, taking away `numRedos` nodes from the queue. We replaced them with one new node.
            this.len -= this.numRedos - 1;
            // There are no redos following the new tail node.
            this.numRedos = 0;

            // Trim the queue if necessary.
            if (this.len > this.maxLen && this.oldestUndo) {
                const nextOldest = this.oldestUndo.next!;
                nextOldest.prev = null;
                this.oldestUndo = nextOldest;
                this.len--;
            }
        }
        // After `idleTime` ms, we treat the value as completed.
        this.timeoutId = window.setTimeout(() => {
            this.timeoutId = 0;
        }, this.idleTime);
    }

    undo() {
        if (this.undos === null || this.undos.prev === null) return;
        // If there's a pending timeout, clear it and treat the latest undo value as "committed"
        if (this.timeoutId) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = 0;
        }
        this.undos = this.undos.prev;
        this.numRedos++;
        return this.undos.value;
    }

    redo() {
        if (this.undos === null || this.undos.next === null) return;
        if (this.timeoutId) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = 0;
        }
        this.undos = this.undos.next;
        this.numRedos--;
        return this.undos.value;
    }

    get canUndo() {
        return this.undos !== null && this.undos.prev !== null;
    }

    get canRedo() {
        return this.undos !== null && this.undos.next !== null;
    }
}
