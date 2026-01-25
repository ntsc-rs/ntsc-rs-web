import style from './style.module.scss';

import type {ComponentChildren, JSX} from 'preact';
import {createContext} from 'preact';
import {useCallback, useContext, useEffect, useMemo, useRef} from 'preact/hooks';
import {batch, signal, Signal, useComputed, useSignal} from '@preact/signals';
import classNames from 'clsx';

import {IconButton} from '../Icon/Icon';
import Icon from '../Icon/Icon';
import {Button, ContextMenuItem, useContextMenu} from '../Widgets/Widgets';
import {useAddErrorToast} from '../Toast/Toast';
import {useAppState, SelectedPreset, PresetsDirState} from '../../app-state';
import ResizablePanel from '../ResizablePanel/ResizablePanel';
import Directory, {DirStatus} from '../../util/signalize-fs';
import saveToFile from '../../util/save-to-file';
import showOpenFilePicker from '../../util/file-picker';
import {useThrottledComputed} from '../../util/throttle';
import {
    DragDropProvider,
    useDraggable,
    useDroppable,
    DragItem,
    DragConfig,
    DropConfig,
    Droppable,
    TypedDroppable,
} from '../../util/drag-drop';
import Loader from '../Loader/Loader';

type PartialHandle = {
    kind: 'file' | 'directory' | 'placeholderFile' | 'placeholderDirectory';
    name: string;
};

// Data attached to dragged preset files
export type PresetDragData = {
    handle: FileSystemFileHandle;
    sourceDir: Directory;
    path: string;
};

// Context for sharing state within the preset manager tree
type PresetTreeContextType = {
    selectedPreset: Signal<SelectedPreset | null>;
    renamePath: Signal<string | undefined>;
    loadingPath: Signal<string | undefined>;
    newPresetParent: Signal<{dir: Directory; path: string} | null>;
    newDirParent: Signal<{dir: Directory; path: string} | null>;
    isModified: Signal<boolean>;
    showContextMenu: (event: MouseEvent, items: ContextMenuItem[]) => void;
    addErrorToast: (message: string, err: unknown) => void;
    onSelectPreset: (handle: FileSystemFileHandle, path: string) => void;
    onRenameComplete: (handle: FileSystemFileHandle, parent: Directory, newName: string) => void;
    onNewPresetNameSet: (handle: PartialHandle, name: string) => void;
    onNewDirNameSet: (handle: PartialHandle, name: string) => void;
    onMovePreset: (item: DragItem<PresetDragData>, targetDir: {dir: Directory, path: string}) => void;
    onDropPresets: (items: DataTransferItemList, targetDir: Directory) => void;
};

const PresetTreeContext = createContext<PresetTreeContextType | null>(null);

const usePresetTree = () => {
    const ctx = useContext(PresetTreeContext);
    if (!ctx) throw new Error('usePresetTree must be used within PresetManager');
    return ctx;
};

const directoryContextMenu = (
    ctx: PresetTreeContextType,
    dirItem: {
        dir: Directory,
        path: string,
    },
    parentDir?: Directory,
): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
        {
            id: 'save-preset',
            label: 'Save new preset here',
            icon: 'file',
            onClick: () => {
                ctx.newPresetParent.value = dirItem;
            },
        },
        {
            id: 'new-folder',
            label: 'New folder',
            icon: 'folder',
            onClick: () => {
                ctx.newDirParent.value = dirItem;
            },
        },
    ];
    if (parentDir) {
        items.push(
            {
                id: 'delete',
                label: 'Delete folder',
                icon: 'close',
                onClick: async() => {
                    try {
                        if (ctx.selectedPreset.value?.path.startsWith(dirItem.path + '/')) {
                            ctx.selectedPreset.value = null;
                        }
                        await parentDir.deleteDirectory(dirItem.dir.name);
                    } catch (err) {
                        ctx.addErrorToast(errorWithFileName('Failed to delete folder', dirItem.dir.name), err);
                    }
                },
            },
        );
    }
    return items;
};

const writeSingleChunk = async(handle: FileSystemFileHandle, chunk: FileSystemWriteChunkType) => {
    const writable = await handle.createWritable();
    try {
        await writable.write(chunk);
    } finally {
        await writable.close();
    }
};

const NO_DRAG_CONFIG: DragConfig<PresetDragData> = {
    typeKey: '',
    data: undefined as never,
    disabled: true,
};

const NO_DROP_CONFIG: DropConfig<DragItem<PresetDragData> | DataTransferItemList> = {
    onDrop: () => {},
    canDropItem: (item: Droppable): item is TypedDroppable<DragItem<PresetDragData> | DataTransferItemList> => false,
    disabled: true,
};

const Entry = <Handle extends PartialHandle>({
    handle,
    path,
    indent,
    collapsed,
    selected,
    modified,
    isRenaming,
    isLoading,
    dragConfig,
    dropConfig,
    onClick,
    onContextMenu,
    onRename,
    children,
}: {
    handle: Handle;
    path: string;
    indent: number;
    collapsed?: Signal<boolean>;
    selected?: boolean;
    modified?: boolean;
    isRenaming?: boolean;
    isLoading?: boolean;
    dragConfig?: DragConfig<PresetDragData>;
    dropConfig?: DropConfig<DragItem<PresetDragData> | DataTransferItemList>;
    onClick?: (handle: Handle, path: string) => void;
    onContextMenu?: (event: MouseEvent, handle: Handle, path: string) => void;
    onRename?: (handle: Handle, newName: string) => void;
    children?: ComponentChildren;
}): JSX.Element => {
    // Set up drag functionality if configured
    const {dragProps, isDragging} = useDraggable(dragConfig ?? NO_DRAG_CONFIG);

    // Set up drop functionality if configured
    const {dropProps, isOver} = useDroppable(dropConfig ?? NO_DROP_CONFIG);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const handlers = useMemo(() => {
        const focusInput = (elem: HTMLInputElement | null) => {
            inputRef.current = elem;
            if (!elem) return;
            elem.value = handle.name;
            elem.focus();
            // Select the name without extension for files
            if (handle.kind === 'file') {
                const dotIndex = handle.name.lastIndexOf('.');
                if (dotIndex > 0) {
                    elem.setSelectionRange(0, dotIndex);
                } else {
                    elem.select();
                }
            } else {
                elem.select();
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                onRename?.(handle, (event.target as HTMLInputElement).value);
            } else if (event.key === 'Escape') {
                onRename?.(handle, '');
            }
        };

        // Confirm: submit the current input value
        const handleConfirm = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            onRename?.(handle, inputRef.current?.value ?? '');
        };

        // Cancel: submit empty string to indicate cancellation
        const handleCancel = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            onRename?.(handle, '');
        };

        // Prevent blur when clicking the confirm/cancel buttons
        const preventBlur = (event: MouseEvent) => {
            event.preventDefault();
        };

        const handleClick = (event: MouseEvent) => {
            if (!onClick) return;
            // Clicking inside the input when renaming a preset should not select the preset
            if ((event.target as HTMLElement).contains(inputRef.current)) return;
            event.preventDefault();
            event.stopPropagation();
            onClick(handle, path);
        };

        const handleContextMenuEvent = (event: MouseEvent) => {
            if (!onContextMenu) return;
            event.preventDefault();
            event.stopPropagation();
            onContextMenu(event, handle, path);
        };

        return {
            focusInput,
            handleKeyDown,
            handleConfirm,
            handleCancel,
            preventBlur,
            handleClick,
            handleContextMenuEvent,
        };
    }, [handle, path, inputRef, onRename, onClick, onContextMenu]);

    return useMemo(() => {
        // Display name with asterisk if modified
        const displayName = selected && modified ? `* ${handle.name}` : handle.name;
        const isDirectory = handle.kind === 'directory' || handle.kind === 'placeholderDirectory';

        return (
            <div className={style.entry} {...dropProps}>
                <div
                    className={classNames(
                        style.entryHeader,
                        selected && style.selected,
                        isLoading && style.loading,
                        isDragging.value && style.dragging,
                        isOver.value && style.dropTarget,
                    )}
                    onClick={handlers.handleClick}
                    onContextMenu={handlers.handleContextMenuEvent}
                    {...dragProps}
                    {...dropProps}
                >
                    {Array.from({length: Math.max(0, indent - 1)}, (_, i) => (
                        <div key={i} className={style.indent} />
                    ))}
                    {collapsed && (
                        <div className={style.collapseIcon}>
                            <Icon
                                className={style.collapseIcon}
                                type={collapsed.value ? 'arrow-right' : 'arrow-down'}
                                title={collapsed.value ? 'Expand' : 'Collapse'}
                                size="1rem"
                            />
                        </div>
                    )}
                    <div className={style.entryInfo}>
                        <Icon
                            className={style.entryIcon}
                            type={isDirectory ?
                                'folder' :
                                'file'}
                            title={isDirectory ? 'Folder' : 'Preset'}
                        />
                        {isRenaming ? (
                            <>
                                <input
                                    ref={handlers.focusInput}
                                    type="text"
                                    className={style.renameInput}
                                    onKeyDown={handlers.handleKeyDown}
                                />
                                <IconButton
                                    type="check"
                                    title="Confirm"
                                    className={style.renameButton}
                                    onMouseDown={handlers.preventBlur}
                                    onClick={handlers.handleConfirm}
                                />
                                <IconButton
                                    type="close"
                                    title="Cancel"
                                    className={style.renameButton}
                                    onMouseDown={handlers.preventBlur}
                                    onClick={handlers.handleCancel}
                                />
                            </>
                        ) : (
                            <span className={style.entryName}>{displayName}</span>
                        )}
                    </div>
                </div>
                {(!collapsed || !collapsed.value) && children && (
                    <div className={style.entryChildren}>{children}</div>
                )}
            </div>
        );
    }, [
        handlers,
        handle,
        indent,
        collapsed,
        collapsed?.value,
        selected,
        modified,
        isRenaming,
        isLoading,
        children,
        dragProps.draggable,
        dragProps.onDragStart,
        dragProps.onDragEnd,
        dropProps.onDragEnter,
        dropProps.onDragLeave,
        dropProps.onDragOver,
        dropProps.onDrop,
        isDragging.value,
        isOver.value,
    ]);
};

const DroppableRootList = ({
    presetsDir,
}: {
    presetsDir: Signal<PresetsDirState>;
}): JSX.Element => {
    const ctx = usePresetTree();
    const {onMovePreset, onDropPresets, newPresetParent, newDirParent} = ctx;

    const handleAmbientContextMenu = useMemo(() => {
        if (presetsDir.value.state !== 'loaded') return;
        const items = directoryContextMenu(ctx, presetsDir.value.root);
        return (event: MouseEvent) => {
            ctx.showContextMenu(event, items);
        };
    }, [ctx, presetsDir]);

    const handleDrop = useCallback((droppable: TypedDroppable<DragItem<PresetDragData> | DataTransferItemList>) => {
        if (presetsDir.value.state !== 'loaded') return;
        if (droppable.kind === 'drag') {
            onMovePreset(droppable.value as DragItem<PresetDragData>, presetsDir.value.root);
        } else {
            onDropPresets(droppable.value, presetsDir.value.root.dir);
        }
    }, [onMovePreset, onDropPresets, presetsDir]);

    const canDropHere = useCallback((droppable: Droppable):
        droppable is TypedDroppable<DragItem<PresetDragData> | DataTransferItemList> => {
        if (droppable.kind !== 'drag') {
            for (const item of droppable.value) {
                if (item.kind === 'file') return true;
            }
            return false;
        }
        // Can't drop into the same directory it's already in
        return presetsDir.value.state === 'loaded' &&
            (droppable.value as DragItem<PresetDragData>).data.sourceDir !== presetsDir.value.root.dir;
    }, [presetsDir]);

    const {dropProps, isOver} = useDroppable<DragItem<PresetDragData> | DataTransferItemList>({
        onDrop: handleDrop,
        canDropItem: canDropHere,
        disabled: !presetsDir,
    });

    const inner = useComputed(() => {
        switch (presetsDir.value.state) {
            case 'not_loaded':
            case 'loading':
                return <div className={style.loadingState}><Loader /></div>;
            case 'loaded': {
                const dirState = presetsDir.value.root.dir.value;
                if (dirState.status === DirStatus.NOT_TRAVERSED ||
                    (dirState.status === DirStatus.TRAVERSING && !dirState.entries)) {
                    return <div className={style.loadingState}><Loader /></div>;
                }
                if (dirState.status === DirStatus.FAILED) {
                    return (
                        <div className={style.errorState}>
                            <Icon type="error" title="Error" />
                            <div className={style.errorMessage}>{dirState.message}</div>
                        </div>
                    );
                }
                if (
                    dirState.status === DirStatus.TRAVERSED &&
                    !dirState.entries.length &&
                    !newPresetParent.value && !newDirParent.value
                ) {
                    return (
                        <div className={style.emptyState}>
                            <header>No presets saved yet</header>
                            <div>To create a preset, use "Save as".</div>
                            <div>To import a preset, use "Import" or drag presets into this area.</div>
                        </div>
                    );
                }
                return <DirectoryListing
                    dir={presetsDir.value.root.dir}
                    path={presetsDir.value.root.path}
                    indent={0}
                />;
            }
            case 'error':
                return <div className={style.errorState}>
                    <header>Error loading presets folder</header>
                    {presetsDir.value.error instanceof Error ?
                        <div className={style.errorMessage}>{presetsDir.value.error.message}</div> :
                        null}
                </div>;
        }
    });


    return (
        <div
            className={classNames(style.presetList, isOver.value && style.dropTarget)}
            onContextMenu={handleAmbientContextMenu}
            {...dropProps}
        >
            {inner}
        </div>
    );
};

const DirectoryListing = ({
    dir,
    path,
    indent,
}: {
    dir: Directory;
    path: string;
    indent: number;
}): JSX.Element => {
    const ctx = usePresetTree();

    // File context menu
    const handleFileContextMenu = useCallback((
        event: MouseEvent,
        handle: FileSystemFileHandle,
        filePath: string,
    ) => {
        return ctx.showContextMenu(event, [
            {
                id: 'export',
                label: 'Export',
                icon: 'download',
                onClick: async() => {
                    try {
                        const file = await handle.getFile();
                        const blob = new Blob([await file.text()], {type: 'application/json'});
                        saveToFile(handle.name, blob);
                    } catch (err) {
                        ctx.addErrorToast(errorWithFileName('Failed to export preset', handle.name), err);
                    }
                },
            },
            {
                id: 'rename',
                label: 'Rename',
                icon: 'edit',
                onClick: () => {
                    ctx.renamePath.value = filePath;
                },
            },
            {
                id: 'delete',
                label: 'Delete',
                icon: 'close',
                onClick: async() => {
                    try {
                        if (ctx.selectedPreset.value?.path === filePath) {
                            ctx.selectedPreset.value = null;
                        }
                        await dir.deleteFile(handle.name);
                    } catch (err) {
                        ctx.addErrorToast(errorWithFileName('Failed to delete preset', handle.name), err);
                    }
                },
            },
        ]);
    }, [ctx, dir, path]);

    // File rename handler
    const handleFileRename = useCallback((handle: FileSystemFileHandle, newName: string) => {
        ctx.onRenameComplete(handle, dir, newName);
    }, [ctx, dir, path]);

    useEffect(() => {
        if (dir.value.status === DirStatus.NOT_TRAVERSED) {
            void dir.traverse();
        }
    }, [dir, path]);

    const dirState = dir.value;
    const selectedPath = ctx.selectedPreset.value?.path;
    const renamePathValue = ctx.renamePath.value;
    const loadingPathValue = ctx.loadingPath.value;
    const newPresetDir = ctx.newPresetParent.value?.dir;
    const newDirDir = ctx.newDirParent.value?.dir;
    const isModified = ctx.isModified.value;

    // Use entries from TRAVERSED state, or previous entries from TRAVERSING state
    const entries =
        dirState.status === DirStatus.TRAVERSED ? dirState.entries :
            dirState.status === DirStatus.TRAVERSING ? dirState.entries :
                null;

    if (!entries) {
        const indents = Array.from({length: Math.max(0, indent)}, (_, i) => (
            <div key={i} className={style.indent} />
        ));
        switch (dirState.status) {
            case DirStatus.TRAVERSING:
            case DirStatus.NOT_TRAVERSED:
                return <div className={classNames(style.entryHeader, style.entryPlaceholder)}>
                    {indents}
                    <Loader size={18} />
                    Loading...
                </div>;
            case DirStatus.FAILED:
                return <div
                    className={classNames(style.entryHeader, style.entryPlaceholder, style.entryError)}
                >
                    {indents}
                    {dirState.message}
                </div>;
            default:
                throw new Error('Unreachable');
        }
    }

    const elements: JSX.Element[] = [];

    // Render directories first (entries are already sorted: dirs first, then files)
    for (const entry of entries) {
        if (!(entry instanceof Directory)) break;

        const entryPath = `${path}/${entry.name}`;
        elements.push(
            <DirectoryEntry
                key={entryPath}
                dir={entry}
                path={entryPath}
                parentDir={dir}
                indent={indent + 1}
            />,
        );
    }

    // New directory placeholder appears after existing directories
    if (newDirDir === dir) {
        elements.push(
            <Entry
                key={`${path}/__new_dir__`}
                handle={{kind: 'directory' as const, name: ''}}
                path={`${path}/`}
                indent={indent + 1}
                isRenaming={true}
                onRename={ctx.onNewDirNameSet}
            />,
        );
    }

    // Then render files
    for (const entry of entries) {
        if (entry instanceof Directory) continue;

        const entryPath = `${path}/${entry.name}`;
        const isSelected = selectedPath === entryPath;
        const isEntryRenaming = renamePathValue === entryPath;
        if (entry.kind === 'placeholderFile' || entry.kind === 'placeholderDirectory') {
            elements.push(
                <Entry
                    key={entryPath}
                    handle={entry}
                    path={entryPath}
                    indent={indent + 1}
                    selected={isSelected}
                    modified={isSelected && isModified}
                    isRenaming={isEntryRenaming}
                    isLoading={loadingPathValue === entryPath}
                />,
            );
        } else {
            const realEntry = entry as FileSystemFileHandle;
            elements.push(
                <Entry
                    key={entryPath}
                    handle={realEntry}
                    path={entryPath}
                    indent={indent + 1}
                    selected={isSelected}
                    modified={isSelected && isModified}
                    isRenaming={isEntryRenaming}
                    isLoading={loadingPathValue === entryPath}
                    dragConfig={{
                        typeKey: 'preset',
                        data: {handle: realEntry, sourceDir: dir, path: entryPath},
                        disabled: isEntryRenaming,
                    }}
                    onClick={ctx.onSelectPreset}
                    onContextMenu={handleFileContextMenu}
                    onRename={handleFileRename}
                />,
            );
        }
    }

    // New preset placeholder appears after existing files
    if (newPresetDir === dir) {
        elements.push(
            <Entry
                key={`${path}/__new_preset__`}
                handle={{kind: 'file' as const, name: ''}}
                path={`${path}/`}
                indent={indent + 1}
                isRenaming={true}
                onRename={ctx.onNewPresetNameSet}
            />,
        );
    }

    return <>{elements}</>;
};

const DirectoryEntry = ({
    dir,
    path,
    parentDir,
    indent,
}: {
    dir: Directory,
    path: string,
    parentDir?: Directory;
    indent: number;
}): JSX.Element => {
    const ctx = usePresetTree();

    const collapsed = useSignal(true);
    const handleDirClick = useCallback(() => {
        collapsed.value = !collapsed.value;
    }, [collapsed]);

    // Directory context menu
    const handleDirContextMenu = useMemo(() => {
        const items = directoryContextMenu(ctx, {dir, path}, parentDir);
        return (
            event: MouseEvent,
            _handle: FileSystemDirectoryHandle,
            _dirPath: string,
        ) => ctx.showContextMenu(event, items);
    }, [ctx, dir, path, parentDir]);

    const dropConfig = useMemo<DropConfig<DragItem<PresetDragData> | DataTransferItemList>>(() => {
        return {
            onDrop: (item) => {
                if (item.kind === 'drag') {
                    ctx.onMovePreset(item.value as DragItem<PresetDragData>, {dir, path});
                } else {
                    ctx.onDropPresets(item.value, dir);
                }
            },
            canDropItem: (droppable): droppable is TypedDroppable<DragItem<PresetDragData> | DataTransferItemList> => {
                if (droppable.kind !== 'drag') {
                    for (const item of droppable.value) {
                        if (item.kind === 'file') return true;
                    }
                    return false;
                }
                // Can't drop into the same directory it's already in
                return (droppable.value as DragItem<PresetDragData>).data.sourceDir !== dir;
            },
        };
    }, [ctx, dir, path]);

    const listing = useMemo(() => {
        return collapsed.value ? null : <DirectoryListing
            dir={dir}
            path={path}
            indent={indent}
        />;
    }, [collapsed.value, dir, path, indent]);

    return (
        <Entry
            handle={dir.handle}
            path={path}
            indent={indent}
            collapsed={collapsed}
            dropConfig={dropConfig}
            onClick={handleDirClick}
            onContextMenu={handleDirContextMenu}
        >
            {listing}
        </Entry>
    );
};

const errorWithFileName = (message: string, fileName: string | null) => {
    if (!fileName) return message;
    return `${message} "${fileName}"`;
};

const usePresetManagerState = () => {
    const appState = useAppState();
    // Check if current settings differ from selected preset (throttled)
    const isModified = useThrottledComputed(
        () => appState.isPresetModified(),
        [appState.settingsAsObject, appState.presetsState.selectedPreset],
        500,
    );
    const showContextMenu = useContextMenu();
    const addErrorToast = useAddErrorToast();
    return useMemo(() => {
        const {presetsDir, presetsPanelOpen, selectedPreset} = appState.presetsState;

        const loadingPath = signal<string | undefined>();
        const renamePath = signal<string | undefined>();
        const newPresetParent = signal<{dir: Directory; path: string} | null>(null);
        const newDirParent = signal<{dir: Directory; path: string} | null>(null);

        const handleReload = () => {
            if (presetsDir.value.state !== 'loaded') return;
            void presetsDir.value.root.dir.traverse(true);
        };

        const togglePanel = () => {
            presetsPanelOpen.value = !presetsPanelOpen.value;
        };

        const onSelectPreset = async(handle: FileSystemFileHandle, path: string) => {
            loadingPath.value = path;
            try {
                const file = await handle.getFile();
                const json = await file.text();
                const settingsObj = await appState.parsePreset(json);
                batch(() => {
                    selectedPreset.value = {path, handle, originalSettings: settingsObj};
                    appState.settingsFromObject(settingsObj);
                });
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to load preset', handle.name), err);
            } finally {
                loadingPath.value = undefined;
            }
        };

        const importPresetFiles = async(items: File[] | FileList, targetDir: Directory) => {
            let fileName = null;
            try {
                const presetsDirCurrent = presetsDir.value;
                if (presetsDirCurrent.state !== 'loaded') return;
                for (const item of items) {
                    fileName = item.name;
                    const handle = await targetDir.createFile(item.name);
                    await writeSingleChunk(handle, item);
                }
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to import preset', fileName), err);
            }
        };

        const onDropPresets = (items: DataTransferItemList, targetDir: Directory) => {
            const presetsDirCurrent = presetsDir.value;
            if (presetsDirCurrent.state !== 'loaded') return;
            const files = [];
            for (const item of items) {
                const file = item.getAsFile();
                if (!file) continue;
                files.push(file);
            }
            void importPresetFiles(files, targetDir);
        };

        const onRenameComplete = async(
            handle: FileSystemFileHandle,
            parent: Directory,
            newName: string,
        ) => {
            const oldPath = renamePath.value;
            renamePath.value = undefined;
            if (!newName || newName === handle.name) return;

            try {
                await parent.moveFile(handle, newName);
                if (selectedPreset.value && oldPath && selectedPreset.value.path === oldPath) {
                    const newPath = oldPath.replace(/\/[^/]+$/, `/${newName}`);
                    selectedPreset.value = {...selectedPreset.value, path: newPath};
                }
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to rename preset', handle.name), err);
            }
        };

        const onNewDirNameSet = async(_handle: PartialHandle, name: string) => {
            const parentInfo = newDirParent.value;
            newDirParent.value = null;
            if (!name || !parentInfo) return;

            try {
                await parentInfo.dir.createDirectory(name);
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to create folder', name), err);
            }
        };

        const handleSaveToLibrary = () => {
            if (presetsDir.value.state !== 'loaded') return;
            newPresetParent.value = presetsDir.value.root;
        };

        const handleNewFolder = () => {
            if (presetsDir.value.state !== 'loaded') return;
            newDirParent.value = presetsDir.value.root;
        };

        const onNewPresetNameSet = async(_handle: PartialHandle, name: string) => {
            const parentInfo = newPresetParent.value;
            newPresetParent.value = null;
            if (!name || !parentInfo) return;

            const fileName = name.endsWith('.json') ? name : `${name}.json`;
            try {
                const handle = await parentInfo.dir.createFile(fileName);
                const json = JSON.stringify(appState.settingsAsObject.value);
                await writeSingleChunk(handle, json);
                selectedPreset.value = {
                    path: `${parentInfo.path}/${fileName}`,
                    handle,
                    originalSettings: appState.settingsAsObject.value,
                };
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to save preset', name), err);
            }
        };

        const handleOverwrite = async() => {
            if (!selectedPreset.value) return;
            try {
                const json = JSON.stringify(appState.settingsAsObject.value);
                await writeSingleChunk(selectedPreset.value.handle, json);
                selectedPreset.value = {
                    ...selectedPreset.value,
                    originalSettings: appState.settingsAsObject.value,
                };
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to overwrite preset', selectedPreset.value.handle.name), err);
            }
        };

        const handleImport = async() => {
            const files = await showOpenFilePicker({accept: 'application/json', multiple: true});
            if (!files || presetsDir.value.state !== 'loaded') return;
            await importPresetFiles(files, presetsDir.value.root.dir);
        };

        const onMovePreset = async(
            item: DragItem<PresetDragData>,
            targetDir: {dir: Directory, path: string},
        ) => {
            const {handle, sourceDir, path: sourcePath} = item.data;
            if (sourceDir === targetDir.dir || handle.kind !== 'file') return;

            try {
                await targetDir.dir.moveFile(handle, handle.name, sourceDir);
                void sourceDir.traverse();
                void targetDir.dir.traverse();
                if (selectedPreset.value?.path === sourcePath) {
                    selectedPreset.value = {...selectedPreset.value, path: `${targetDir.path}/${handle.name}`};
                }
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to move preset', item.data.handle.name), err);
            }
        };

        return {
            selectedPreset,
            renamePath,
            loadingPath,
            newPresetParent,
            newDirParent,
            isModified,

            handleReload,
            togglePanel,
            handleSaveToLibrary,
            handleNewFolder,
            handleOverwrite,
            handleImport,

            showContextMenu,
            addErrorToast,
            onSelectPreset,
            onRenameComplete,
            onNewPresetNameSet,
            onNewDirNameSet,
            onMovePreset,
            onDropPresets,
        };
    }, [appState.presetsState.selectedPreset, isModified]);
};

const SettingsActions = (): JSX.Element => {
    const appState = useAppState();
    const {presetsState, canUndo, canRedo} = appState;
    const {presetsPanelOpen} = presetsState;
    const addErrorToast = useAddErrorToast();

    const handlers = useMemo(() => {
        const handleUndo = () => {
            appState.undo();
        };

        const handleRedo = () => {
            appState.redo();
        };

        const handleCopy = () => {
            navigator.clipboard.writeText(JSON.stringify(appState.settingsAsObject.value))
                .then(undefined, err => addErrorToast('Failed to copy settings', err));
        };

        const handlePaste = async() => {
            try {
                const settingsJSON = await navigator.clipboard.readText();
                const settingsObj = await appState.parsePreset(settingsJSON);
                appState.settingsFromObject(settingsObj);
            } catch (err) {
                addErrorToast('Failed to paste settings', err);
            }
        };

        const handleSaveToFile = () => {
            const settingsStr = JSON.stringify(appState.settingsAsObject.value);
            const settingsBlob = new Blob([new TextEncoder().encode(settingsStr)], {type: 'application/json'});
            saveToFile('preset.json', settingsBlob);
        };

        const handleOpenFile = async() => {
            let fileName = null;
            try {
                const files = await showOpenFilePicker({accept: 'application/json'});
                const file = files?.[0];
                if (!file) return;
                fileName = file.name;
                const settingsJSON = await file.text();
                if (!settingsJSON) return;
                const settingsObj = await appState.parsePreset(settingsJSON);
                appState.settingsFromObject(settingsObj);
            } catch (err) {
                addErrorToast(errorWithFileName('Failed to load preset', fileName), err);
            }
        };

        const handleReset = () => {
            // We should provide some way to un-select a preset, and the reset button seems like a conceptually good
            // place to do so.
            batch(() => {
                appState.presetsState.selectedPreset.value = null;
                appState.settingsFromObject(appState.defaultSettings);
            });
        };

        return {
            handleUndo,
            handleRedo,
            handleCopy,
            handlePaste,
            handleSaveToFile,
            handleOpenFile,
            handleReset,
        };
    }, [appState, addErrorToast]);

    return (
        <div className={classNames(style.settingsSection, presetsPanelOpen.value && style.open)}>
            <div className={style.headerTitle}>Current settings:</div>
            <div className={style.currentSettingsActions}>
                <IconButton type="undo" disabled={!canUndo.value} title="Undo" onClick={handlers.handleUndo} />
                <IconButton type="redo" disabled={!canRedo.value} title="Redo" onClick={handlers.handleRedo} />
                <div className={style.divider} />
                <IconButton type="copy" title="Copy to clipboard" onClick={handlers.handleCopy} />
                <IconButton type="paste" title="Paste from clipboard" onClick={handlers.handlePaste} />
                <IconButton type="download" title="Save to file" onClick={handlers.handleSaveToFile} />
                <IconButton type="upload" title="Open from file" onClick={handlers.handleOpenFile} />
                <IconButton type="reset" title="Reset to defaults" onClick={handlers.handleReset} />
            </div>
        </div>
    );
};

const PresetManager = (): JSX.Element => {
    const appState = useAppState();
    const {presetsDir, selectedPreset, presetsPanelOpen} = appState.presetsState;

    const contextValue = usePresetManagerState();

    useEffect(() => {
        // It's fine to call this with no checks, since it does nothing if the presets dir is loading or loaded
        void appState.initPresetsDir();
    }, []);

    const libraryHeader = (
        <button className={style.panelHeader} onClick={contextValue.togglePanel}>
            <Icon
                className={style.headerCollapseIcon}
                type={presetsPanelOpen.value ? 'arrow-down' : 'arrow-right'}
                title={presetsPanelOpen.value ? 'Collapse' : 'Expand'}
                size={16}
            />
            <span className={style.headerTitle}>Preset library</span>
        </button>
    );

    const canOverwrite = !selectedPreset.value || !contextValue.isModified.value;

    return useMemo(() => (
        <div className={style.presetManager}>
            <SettingsActions />

            {presetsPanelOpen.value ?
                <ResizablePanel
                    className={style.panelBody}
                    initialSize="400px"
                    minSize="200px"
                    maxSize="75vh"
                    edge="top"
                >
                    <div className={style.librarySection}>
                        {libraryHeader}
                        <div className={classNames(style.libraryInner)}>
                            <DragDropProvider>
                                <PresetTreeContext.Provider value={contextValue}>
                                    <DroppableRootList presetsDir={presetsDir} />
                                </PresetTreeContext.Provider>
                            </DragDropProvider>
                            <div className={style.libraryToolbar}>
                                <Button
                                    onClick={contextValue.handleSaveToLibrary}
                                    title="Save current settings as new preset in library"
                                >
                                    Save As
                                </Button>
                                <Button
                                    onClick={contextValue.handleOverwrite}
                                    disabled={canOverwrite}
                                    title="Overwrite selected preset with current settings"
                                >
                                    Overwrite
                                </Button>
                                <Button
                                    onClick={contextValue.handleNewFolder}
                                    title="Create new folder in library"
                                >
                                    New Folder
                                </Button>
                                <Button
                                    onClick={contextValue.handleImport}
                                    title="Import preset files into library"
                                >
                                    Import
                                </Button>
                                <Button onClick={contextValue.handleReload} title="Reload library">
                                    Reload
                                </Button>
                            </div>
                        </div>
                    </div>
                </ResizablePanel> :
                libraryHeader
            }
        </div>
    ), [contextValue, presetsDir, canOverwrite, presetsPanelOpen.value]);
};

export default PresetManager;
