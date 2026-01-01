import {WorkerSchema} from './effect-worker.worker';
import RpcDispatcher from './worker-rpc';
import {ResizeFilter} from 'ntsc-rs-web-wrapper';

export type EffectWorker = RpcDispatcher<WorkerSchema>;

type QueueNode = {
    resolve: (worker: EffectWorker) => void,
    next: QueueNode,
} | null;

const messageMap = {
    'render-frame': 'rendered-frame',
    'init': 'initialized',
} as const;
type Runner<T> = (cb: (worker: EffectWorker) => Promise<T>) => Promise<T>;

const taskRegistry = new FinalizationRegistry<null>(() => {
    // eslint-disable-next-line no-console
    console.error('A worker pool task was garbage-collected without being run or cancelled.');
});

export type RenderFrameSettings = {
    frame: VideoFrame,
    resizeHeight: number | null,
    resizeFilter: ResizeFilter,
    effectEnabled: boolean,
    effectSettings: Record<string, number | boolean>,
    frameNum: number,
};

export default class EffectWorkerPool {
    private workers: EffectWorker[] = [];
    private queueHead: QueueNode = null;
    private queueTail: QueueNode = null;
    private effectSettingsPerWorker = new WeakMap<EffectWorker, Record<string, number | boolean>>();
    allWorkers: EffectWorker[] = [];

    private constructor(workers: EffectWorker[], allWorkers: EffectWorker[]) {
        this.workers = workers;
        this.allWorkers = allWorkers;
    }

    static async create(concurrency?: number) {
        if (!concurrency) concurrency = navigator.hardwareConcurrency;
        concurrency = Math.max(1, concurrency);

        const initPromises = [];
        const workers = [];
        const allWorkers = [];
        for (let i = 0; i < concurrency; i++) {
            const worker = new Worker(new URL('./effect-worker.worker.js', import.meta.url), {type: 'module'});

            const dispatcher = new RpcDispatcher<WorkerSchema>(worker, messageMap);
            workers.push(dispatcher);
            allWorkers.push(dispatcher);

            initPromises.push(dispatcher.send('init', null));
        }

        await Promise.all(initPromises);

        return new EffectWorkerPool(workers, allWorkers);
    }

    /**
     * Wait for a worker to become available, then returns a function you can pass a callback into to run with that
     * worker. After the callback is done, the worker is put back into the pool automatically.
     */
    getNextWorker<T>(): Promise<Runner<T>> {
        const p = new Promise((resolve: (worker: EffectWorker) => void) => {
            const node = {resolve, next: null};
            if (this.queueTail) {
                this.queueTail.next = node;
                this.queueTail = node;
            } else {
                this.queueHead = this.queueTail = node;
            }
        }).then(worker => {
            const runner = (cb: (worker: EffectWorker) => Promise<T>) => {
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

    async processFrame(settings: RenderFrameSettings): Promise<() => Promise<ImageBitmap>> {
        const runner = await this.getNextWorker<ImageBitmap>();

        // This is a two-step process. First, we send the frame to the worker to be processed immediately. However, the
        // "runner" callback intentionally does not finish until someone calls the function we return to access the
        // frame. This means that the number of in-flight frames is naturally limited to the number of workers in the
        // pool.
        let release: () => void;
        const waitForRelease = new Promise<void>(resolve => {
            release = resolve;
        });
        const framePromise = runner(async worker => {
            const workerEffectSettings = this.effectSettingsPerWorker.get(worker);
            if (workerEffectSettings !== settings.effectSettings) {
                worker.sendAndForget('update-settings', JSON.stringify(settings.effectSettings));
                this.effectSettingsPerWorker.set(worker, settings.effectSettings);
            }
            const renderedFrame = await worker.send('render-frame', {
                frame: settings.frame,
                resizeHeight: settings.resizeHeight,
                resizeFilter: settings.resizeFilter,
                effectEnabled: settings.effectEnabled,
                frameNum: settings.frameNum,
            }, [settings.frame]);
            await waitForRelease;
            return renderedFrame;
        });

        return () => {
            release();
            return framePromise;
        };
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
