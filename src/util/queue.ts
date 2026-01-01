type QueueNode<T> = {
    value: T,
    next: QueueNode<T>,
} | null;

export default class Queue<T> {
    private head: QueueNode<T> = null;
    private tail: QueueNode<T> = null;

    pushBack(value: T) {
        const node = {value, next: null};
        if (this.tail) {
            this.tail.next = node;
            this.tail = node;
        } else {
            this.head = this.tail = node;
        }
    }

    popFront(): T | undefined {
        const head = this.head;
        if (head) {
            this.head = head.next;
            if (!this.head) {
                this.tail = null;
            }
        }
        return head?.value;
    }

    peekFront(): T | undefined {
        return this.head?.value;
    }

    [Symbol.iterator]() {
        let node = this.head;
        return (function*() {
            while (node !== null) {
                yield node.value;
                node = node.next;
            }
        })();
    }

    drain() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return (function*() {
            let node;
            while ((node = self.head)) {
                yield node.value;
                self.head = node.next;
            }
            self.tail = null;
        })();
    }
}
