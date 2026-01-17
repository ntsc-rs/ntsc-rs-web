import {signal, Signal} from '@preact/signals';

export enum DirStatus {
    NOT_TRAVERSED,
    TRAVERSING,
    TRAVERSED,
    FAILED,
}

class Directory {
    readonly handle;
    signal: Signal<{
        status: DirStatus.NOT_TRAVERSED | DirStatus.TRAVERSING
    } | {
        status: DirStatus.TRAVERSED,
        entries: (FileSystemFileHandle | Directory)[]
    } | {
        status: DirStatus.FAILED,
        message: string
    }>;

    constructor(handle: FileSystemDirectoryHandle) {
        this.handle = handle;
        this.signal = signal({status: DirStatus.NOT_TRAVERSED});
        void this.traverse();
    }

    private setEntries(entries: (FileSystemFileHandle | Directory)[]) {
        entries.sort((a, b) => {
            if (a instanceof Directory && !(b instanceof Directory)) return -1;
            if (b instanceof Directory && !(a instanceof Directory)) return 1;
            const handleA = a instanceof Directory ? a.handle : a;
            const handleB = b instanceof Directory ? b.handle : b;
            return handleA.name.localeCompare(handleB.name);
        });
        this.signal.value = {
            status: DirStatus.TRAVERSED,
            entries,
        };
    }

    async traverse() {
        if (this.signal.peek().status === DirStatus.TRAVERSING) return;

        this.signal.value = {status: DirStatus.TRAVERSING};

        try {
            const entries = [];
            for await (const childHandle of this.handle.values()) {
                entries.push(childHandle.kind === 'directory' ? new Directory(childHandle) : childHandle);
            }
            this.setEntries(entries);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.signal.value = {status: DirStatus.FAILED, message};
        }
    }

    async createFile(name: string) {
        if (this.signal.value.status === DirStatus.TRAVERSED &&
            this.signal.value.entries.some(entry => entry.name === name)) {
            throw new Error('File already exists');
        }

        const newHandle = await this.handle.getFileHandle(name, {create: true});
        const newFile = await newHandle.getFile();
        if (newFile.size > 0) throw new Error('File already exists');

        const curSignal = this.signal.value;
        if (curSignal.status === DirStatus.TRAVERSED) {
            const newEntries = [...curSignal.entries, newHandle];
            this.setEntries(newEntries);
        } else {
            await this.traverse();
        }

        return newHandle;
    }

    async deleteFile(name: string) {
        await this.handle.removeEntry(name);
        await this.traverse();
    }

    async renameFile(oldHandle: FileSystemFileHandle, newName: string) {
        try {
            const existingHandle = await this.handle.getFileHandle(newName);
            throw new Error(`Destination file (${existingHandle.name}) already exists`);
        } catch (err) {
            if ((err as Error).name !== 'NotFoundError') {
                throw err;
            }
        }

        try {
            await oldHandle.move(this.handle, newName);
        } finally {
            await this.traverse();
        }
    }

    get value() {
        return this.signal.value;
    }

    get name() {
        return this.handle.name;
    }
}

export default Directory;
