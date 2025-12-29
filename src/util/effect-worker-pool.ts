import {WorkerSchema} from './effect-worker.worker';
import RpcDispatcher from './worker-rpc';

type QueueNode = {
    resolve: (worker: RpcDispatcher<WorkerSchema>) => void,
    next: QueueNode,
} | null;

const messageMap = {
    'render-frame': 'rendered-frame',
} as const;
type Runner<T> = (cb: (worker: RpcDispatcher<WorkerSchema>) => Promise<T>) => Promise<T>;

const taskRegistry = new FinalizationRegistry<null>(() => {
    // eslint-disable-next-line no-console
    console.error('A worker pool task was garbage-collected without being run or cancelled.');
});

export default class EffectWorkerPool {
    private workers: RpcDispatcher<WorkerSchema>[] = [];
    private queueHead: QueueNode = null;
    private queueTail: QueueNode = null;
    allWorkers: RpcDispatcher<WorkerSchema>[] = [];

    constructor(concurrency?: number) {
        if (!concurrency) concurrency = navigator.hardwareConcurrency;
        concurrency = Math.max(1, concurrency);

        for (let i = 0; i < concurrency; i++) {
            const worker = new Worker(new URL('./effect-worker.worker.js', import.meta.url), {type: 'module'});

            const dispatcher = new RpcDispatcher<WorkerSchema>(worker, messageMap);
            this.workers.push(dispatcher);
            this.allWorkers.push(dispatcher);
        }

        setInterval(() => console.log(this.workers.length), 1000);
    }

    /**
     * Wait for a worker to become available, then returns a function you can pass a callback into to run with that
     * worker. After the callback is done, the worker is put back into the pool automatically.
     */
    getNextWorker<T>(): Promise<Runner<T>> {
        const p = new Promise((resolve: (worker: RpcDispatcher<WorkerSchema>) => void) => {
            const node = {resolve, next: null};
            if (this.queueTail) {
                this.queueTail.next = node;
                this.queueTail = node;
            } else {
                this.queueHead = this.queueTail = node;
            }
        }).then(worker => {
            const runner = (cb: (worker: RpcDispatcher<WorkerSchema>) => Promise<T>) => {
                return cb(worker).finally(() => {
                    taskRegistry.unregister(runner);
                    this.workers.push(worker);
                    this.doWork();
                });
            };
            taskRegistry.register(runner, null, runner);
            return runner;
        });

        this.doWork();

        return p;
    }

    private doWork() {
        if (!this.queueHead || this.workers.length === 0) return;
        const nextWorker = this.workers.pop()!;
        const queueHead = this.queueHead;
        this.queueHead = queueHead.next;
        if (!this.queueHead) this.queueTail = null;

        queueHead.resolve(nextWorker);
    }

    destroy() {
        for (const worker of this.allWorkers) {
            worker.close();
        }
    }
}
