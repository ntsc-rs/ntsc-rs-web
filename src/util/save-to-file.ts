/**
 * Opens a prompt to save a file to the user's local storage.
 * @param name The intended filename.
 * @param contents The file contents.
 */
const saveToFile = (name: string, blob: Blob): void => {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);

    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => {
        window.URL.revokeObjectURL(url);
    }, 0);
};

export default saveToFile;
