import {AppVideoCodec} from '../app-state';
import Queuetex from './async-queue';
import {generateID} from './id';
import RenderJob, {extensionForCodec, RenderJobState, StateChangeEvent} from './render-job';
import {TypedEventTarget} from './typed-events';

const DIRECTORY_NAME = 'render_jobs';
const LIST_NAME = 'jobs.json';

type SerializedRenderJobMetadata = {
    sourceFileName: string;
    videoCodec: AppVideoCodec;
    opfsFileName: string;
    startTime: number;
    state: RenderJobState;
};

class DiskRenderJob extends TypedEventTarget<ProgressEvent | StateChangeEvent | ErrorEvent> {
    sourceFileName: string;
    videoCodec: AppVideoCodec;
    startTime: number;
    state: RenderJobState;
    destination: FileSystemFileHandle;

    constructor(
        sourceFileName: string,
        videoCodec: AppVideoCodec,
        startTime: number,
        state: RenderJobState,
        destination: FileSystemFileHandle,
    ) {
        super();
        this.sourceFileName = sourceFileName;
        this.videoCodec = videoCodec;
        this.startTime = startTime;
        this.state = state;
        this.destination = destination;
    }

    get eta() {
        return null;
    }

    get isOPFS() {
        return true;
    }

    cancel() {}

    toJSON(): SerializedRenderJobMetadata {
        return {
            sourceFileName: this.sourceFileName,
            videoCodec: this.videoCodec,
            opfsFileName: this.destination.name,
            startTime: this.startTime,
            state: this.state,
        };
    }
}

const serializeRenderJob = (job: RenderJobLike): SerializedRenderJobMetadata => {
    let serializedState;
    switch (job.state.state) {
        case 'waiting':
        case 'rendering':
        case 'cancelled':
            serializedState = job.state;
            break;
        case 'completed':
            serializedState = {state: 'completed', time: job.state.time, file: null} as const;
            break;
        case 'error':
            serializedState = {
                state: 'error',
                error: job.state.error instanceof Error ? job.state.error.message : job.state.error,
            } as const;
            break;
    }
    return {
        sourceFileName: job.sourceFileName,
        videoCodec: job.videoCodec,
        opfsFileName: job.destination.name,
        startTime: job.startTime,
        state: serializedState,
    };
};

type SerializedRenderJobList = {
    jobs: SerializedRenderJobMetadata[];
    version: 1;
};

export default class OpfsRenderJobManager {
    private renderJobsDir: Promise<FileSystemDirectoryHandle>;
    private listFile: Queuetex<Promise<FileSystemFileHandle>>;

    constructor() {
        this.renderJobsDir = navigator.storage.getDirectory()
            .then(dir => dir.getDirectoryHandle(DIRECTORY_NAME, {create: true}));
        this.listFile = new Queuetex(this.renderJobsDir.then(dir => dir.getFileHandle(LIST_NAME, {create: true})));
    }

    async initAndDoCleanup() {
        const renderList: DiskRenderJob[] = [];
        const renderJobsDir = await this.renderJobsDir;

        const allRenderedFiles = new Map<string, FileSystemHandleUnion>();
        for await (const [, handle] of renderJobsDir.entries()) {
            if (handle.name === LIST_NAME) {
                continue;
            }
            allRenderedFiles.set(handle.name, handle);
        }

        const knownRenderedFiles = new Set();
        await this.listFile.withValue(async listFile => {
            const contents = await (await listFile).getFile();
            try {
                const textContents = await contents.text();
                if (textContents.length === 0) return;
                const list = JSON.parse(textContents) as SerializedRenderJobList;
                if (list.version !== 1) return;
                for (const job of list.jobs) {
                    const renderedFile = allRenderedFiles.get(job.opfsFileName);
                    if (!renderedFile || renderedFile.kind === 'directory') continue;

                    let hydratedState;
                    switch (job.state.state) {
                        case 'waiting':
                        case 'rendering':
                        case 'cancelled':
                            hydratedState = job.state;
                            break;
                        case 'completed':
                            hydratedState = {
                                state: 'completed',
                                time: job.state.time,
                                file: await renderedFile.getFile(),
                            } as const;
                            break;
                        case 'error':
                            hydratedState = {
                                state: 'error',
                                error: typeof job.state.error === 'string' ?
                                    new Error(job.state.error) :
                                    job.state.error,
                            } as const;
                            break;
                    }
                    const hydrated = new DiskRenderJob(
                        job.sourceFileName,
                        job.videoCodec,
                        job.startTime,
                        hydratedState,
                        renderedFile,
                    );
                    renderList.push(hydrated);
                    knownRenderedFiles.add(job.opfsFileName);
                }
            } catch (err) {
                // If the list is corrupted, don't get stuck
                // eslint-disable-next-line no-console
                console.warn('Failed to load saved render jobs:', err);
            }
        });

        // Clean up any rendered media that's not on our list of render jobs
        const removals = [];
        for (const fileName of allRenderedFiles.keys()) {
            if (!knownRenderedFiles.has(fileName)) {
                removals.push(renderJobsDir.removeEntry(fileName));
            }
        }
        await Promise.all(removals);

        return renderList;
    }

    async persistRenderList(renderList: RenderJobLike[]) {
        await this.listFile.withValue(async listFilePromise => {
            const listFile = await listFilePromise;

            const serializedJobs = [];
            for (const job of renderList) {
                if (!job.isOPFS) continue;
                serializedJobs.push(serializeRenderJob(job));
            }
            const serialized: SerializedRenderJobList = {
                jobs: serializedJobs,
                version: 1,
            };

            const writable = await listFile.createWritable();
            try {
                await writable.write({type: 'write', data: JSON.stringify(serialized)});
            } catch (err) {
                await writable.abort();
                throw err;
            }
            await writable.close();
        });
    }

    async newRenderFile(videoCodec: AppVideoCodec) {
        const renderJobsDir = await this.renderJobsDir;

        const fileName = `${generateID()}.${extensionForCodec(videoCodec)}`;
        const handle = await renderJobsDir.getFileHandle(fileName, {create: true});
        return handle;
    }

    async removeRenderJob(job: RenderJobLike) {
        const renderJobsDir = await this.renderJobsDir;
        try {
            await renderJobsDir.removeEntry(job.destination.name);
        } catch {
            // It might not exist
        }
    }
}

export type RenderJobLike = RenderJob | DiskRenderJob;
