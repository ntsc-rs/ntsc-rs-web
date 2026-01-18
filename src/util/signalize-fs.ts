import {signal, Signal} from '@preact/signals';

export enum DirStatus {
    NOT_TRAVERSED,
    TRAVERSING,
    TRAVERSED,
    FAILED,
}

export type DirEntries = (FileSystemFileHandle | Directory)[];

class Directory {
    readonly handle;
    signal: Signal<{
        status: DirStatus.NOT_TRAVERSED
    } | {
        status: DirStatus.TRAVERSING,
        entries: DirEntries | null  // null if first load, previous entries if re-traversing
    } | {
        status: DirStatus.TRAVERSED,
        entries: DirEntries
    } | {
        status: DirStatus.FAILED,
        message: string
    }>;
    private queuedTraverse = false;

    constructor(handle: FileSystemDirectoryHandle) {
        this.handle = handle;
        this.signal = signal({status: DirStatus.NOT_TRAVERSED});
        void this.traverse();
    }

    private setEntries(entries: DirEntries) {
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

    async traverse(): Promise<void> {
        const current = this.signal.peek();
        if (current.status === DirStatus.TRAVERSING) {
            this.queuedTraverse = true;
            return;
        }

        // Preserve previous entries while re-traversing to avoid layout flicker
        const previousEntries = (current.status === DirStatus.TRAVERSED) ? current.entries : null;
        this.signal.value = {status: DirStatus.TRAVERSING, entries: previousEntries};

        try {
            // Build a map of existing child directories to preserve their state
            const existingDirs = new Map<string, Directory>();
            if (previousEntries) {
                for (const entry of previousEntries) {
                    if (entry instanceof Directory) {
                        // TODO: re-traverse?
                        existingDirs.set(entry.name, entry);
                    }
                }
            }

            const entries: DirEntries = [];
            for await (const childHandle of this.handle.values()) {
                if (childHandle.kind === 'directory') {
                    // Reuse existing Directory object if available to preserve its traversal state
                    const existing = existingDirs.get(childHandle.name);
                    entries.push(existing ?? new Directory(childHandle));
                } else {
                    entries.push(childHandle);
                }
            }
            this.setEntries(entries);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.signal.value = {status: DirStatus.FAILED, message};
        }

        if (this.queuedTraverse) {
            this.queuedTraverse = false;
            return this.traverse();
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

    async deleteDirectory(name: string) {
        await this.handle.removeEntry(name, {recursive: true});
        await this.traverse();
    }

    async createDirectory(name: string) {
        if (this.signal.value.status === DirStatus.TRAVERSED &&
            this.signal.value.entries.some(entry => entry.name === name)) {
            throw new Error('Directory already exists');
        }

        const newHandle = await this.handle.getDirectoryHandle(name, {create: true});
        const newDir = new Directory(newHandle);

        const curSignal = this.signal.value;
        if (curSignal.status === DirStatus.TRAVERSED) {
            const newEntries = [...curSignal.entries, newDir];
            this.setEntries(newEntries);
        } else {
            await this.traverse();
        }

        return newDir;
    }

    async moveFile(oldHandle: FileSystemFileHandle, newName: string, oldParent?: Directory) {
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
            if (oldParent && oldParent !== this) {
                await Promise.all([oldParent.traverse(), this.traverse()]);
            } else {
                await this.traverse();
            }
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
