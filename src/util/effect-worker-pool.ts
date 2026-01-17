import {Formats, WorkerSchema} from './effect-worker.worker';
import Queue from './queue';
import RpcDispatcher from './worker-rpc';
import {ResizeFilter} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

export type EffectWorker = RpcDispatcher<WorkerSchema>;

const messageMap = {
    'render-frame-to-bitmap': 'rendered-frame-to-bitmap',
    'render-frame-to-videoframe': 'rendered-frame-to-videoframe',
    'render-frame-to-png': 'rendered-frame-to-png',
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
    padToEven: boolean,
    frameNum: number,
    outputRect: {
        top: number,
        right: number,
        bottom: number,
        left: number,
    } | null,
};

export default class EffectWorkerPool {
    private workers: EffectWorker[] = [];
    private queue: Queue<(worker: EffectWorker) => void> = new Queue();
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
            this.queue.pushBack(resolve);
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

    async processFrame<F extends keyof Formats>(
        settings: RenderFrameSettings,
        format: F,
    ): Promise<() => Promise<Formats[F]>> {
        const runner = await this.getNextWorker<Formats[F]>();

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
            let renderName;
            switch (format) {
                case 'imagebitmap':
                    renderName = 'render-frame-to-bitmap' as const;
                    break;
                case 'videoframe':
                    renderName = 'render-frame-to-videoframe' as const;
                    break;
                case 'pngBlob':
                    renderName = 'render-frame-to-png' as const;
                    break;
            }
            const renderedFrame = await worker.send(renderName, {
                frame: settings.frame,
                resizeHeight: settings.resizeHeight,
                resizeFilter: settings.resizeFilter,
                effectEnabled: settings.effectEnabled,
                frameNum: settings.frameNum,
                padToEven: true,
                outputRect: settings.outputRect,
            }, [settings.frame]);
            await waitForRelease;
            return renderedFrame as Formats[F];
        });

        return () => {
            release();
            return framePromise;
        };
    }

    private doWork() {
        if (!this.queue.peekFront() || this.workers.length === 0) return;
        const nextWorker = this.workers.pop()!;
        const queueHead = this.queue.popFront()!;
        queueHead(nextWorker);
    }

    destroy() {
        for (const worker of this.allWorkers) {
            worker.close();
        }
    }
}

export const GLOBAL_WORKER_POOL = EffectWorkerPool.create();
