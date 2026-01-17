export {};

declare global {
    interface FileSystemFileHandle extends FileSystemHandle {
        /** Super-secret method that the WHATWG doesn't want you to know about */
        readonly move: (directory: FileSystemDirectoryHandle, newName: string) => Promise<void>;
    }
}
