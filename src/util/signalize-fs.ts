import {signal, Signal} from '@preact/signals';

export enum DirStatus {
    NOT_TRAVERSED,
    TRAVERSING,
    TRAVERSED,
    FAILED,
}

export type PlaceholderHandle = {kind: 'placeholderDirectory' | 'placeholderFile', name: string};

export type DirEntries = (FileSystemFileHandle | Directory)[];
export type LoadingDirEntries = (FileSystemFileHandle | Directory | PlaceholderHandle)[];

class Directory {
    readonly handle;
    signal: Signal<{
        status: DirStatus.NOT_TRAVERSED
    } | {
        status: DirStatus.TRAVERSING,
        entries: LoadingDirEntries | null  // null if first load, previous entries if re-traversing
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
    }

    private static sortEntries(entries: DirEntries | LoadingDirEntries) {
        entries.sort((a, b) => {
            const aIsDir = a instanceof Directory || a.kind === 'placeholderDirectory';
            const bIsDir = b instanceof Directory || b.kind === 'placeholderDirectory';
            if (aIsDir && !bIsDir) return -1;
            if (bIsDir && !aIsDir) return 1;
            const handleA = a instanceof Directory ? a.handle : a;
            const handleB = b instanceof Directory ? b.handle : b;
            return handleA.name.localeCompare(handleB.name);
        });
    }

    private async setEntries(entries: DirEntries) {
        if (this.queuedTraverse) {
            this.queuedTraverse = false;
            return this.traverse();
        }
        Directory.sortEntries(entries);
        this.signal.value = {
            status: DirStatus.TRAVERSED,
            entries,
        };
    }

    private preTraverse(placeholderEntry?: PlaceholderHandle) {
        const current = this.signal.peek();
        if (current.status === DirStatus.TRAVERSING) {
            this.queuedTraverse = true;
            return;
        }
        let previousEntries = null;
        if (current.status === DirStatus.TRAVERSED) {
            if (placeholderEntry) {
                previousEntries = [...current.entries, placeholderEntry];
                Directory.sortEntries(previousEntries);
            } else {
                previousEntries = current.entries;
            }
        }
        this.signal.value = {status: DirStatus.TRAVERSING, entries: previousEntries};
    }

    async traverse(recursive = false): Promise<void> {
        const current = this.signal.peek();

        // Preserve previous entries while re-traversing to avoid layout flicker
        const previousEntries = (current.status === DirStatus.TRAVERSED || current.status === DirStatus.TRAVERSING) ?
            current.entries :
            null;

        try {
            // Build a map of existing child directories to preserve their state
            const existingDirs = new Map<string, Directory>();
            if (previousEntries) {
                for (const entry of previousEntries) {
                    if (entry instanceof Directory) {
                        existingDirs.set(entry.name, entry);
                    }
                }
            }

            const entries: DirEntries = [];
            for await (const childHandle of this.handle.values()) {
                if (childHandle.kind === 'directory') {
                    // Reuse existing Directory object if available to preserve its traversal state
                    const existing = existingDirs.get(childHandle.name);
                    const handle = existing ?? new Directory(childHandle);
                    if (recursive) {
                        void handle.traverse(true);
                    }
                    entries.push(handle);
                } else {
                    entries.push(childHandle);
                }
            }
            return this.setEntries(entries);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.signal.value = {status: DirStatus.FAILED, message};

            if (this.queuedTraverse) {
                this.queuedTraverse = false;
                return this.traverse();
            }
        }
    }

    async createFile(name: string) {
        const curSignal = this.signal.value;
        if (curSignal.status === DirStatus.TRAVERSED &&
            curSignal.entries.some(entry => entry.name === name)) {
            throw new Error('File already exists');
        }
        this.preTraverse({kind: 'placeholderFile', name});

        let newHandle;
        try {
            newHandle = await this.handle.getFileHandle(name, {create: true});
            const newFile = await newHandle.getFile();
            if (newFile.size > 0) throw new Error('File already exists');
        } finally {
            if (newHandle && curSignal === this.signal.value && curSignal.status === DirStatus.TRAVERSED) {
                await this.setEntries([...curSignal.entries, newHandle]);
            } else {
                await this.traverse();
            }
        }

        return newHandle;
    }

    async deleteFile(name: string) {
        this.preTraverse();
        try {
            await this.handle.removeEntry(name);
        } finally {
            await this.traverse();
        }
    }

    async deleteDirectory(name: string) {
        this.preTraverse();
        try {
            await this.handle.removeEntry(name, {recursive: true});
        } finally {
            await this.traverse();
        }
    }

    async createDirectory(name: string) {
        const curSignal = this.signal.value;
        if (curSignal.status === DirStatus.TRAVERSED &&
            curSignal.entries.some(entry => entry.name === name)) {
            throw new Error('Directory already exists');
        }
        this.preTraverse({kind: 'placeholderDirectory', name});

        let newEntries = null, newDir;
        try {
            const newHandle = await this.handle.getDirectoryHandle(name, {create: true});
            newDir = new Directory(newHandle);

            if (curSignal.status === DirStatus.TRAVERSED) {
                newEntries = [...curSignal.entries, newDir];
            }
        } finally {
            if (newEntries && curSignal === this.signal.value) {
                await this.setEntries(newEntries);
            } else {
                await this.traverse();
            }
        }
        return newDir;
    }

    async moveFile(oldHandle: FileSystemFileHandle, newName: string, oldParent?: Directory) {
        this.preTraverse();
        if (oldParent && oldParent !== this) {
            oldParent.preTraverse();
        }
        try {
            try {
                const existingHandle = await this.handle.getFileHandle(newName);
                throw new Error(`Destination file (${existingHandle.name}) already exists`);
            } catch (err) {
                if ((err as Error).name !== 'NotFoundError') {
                    throw err;
                }
            }
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
