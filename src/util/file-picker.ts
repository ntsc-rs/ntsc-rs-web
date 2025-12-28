const showOpenFilePicker = async(options: {
    accept?: string;
    multiple?: boolean;
}): Promise<FileList | null> => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) {
        input.accept = options.accept;
    }
    if (options.multiple) {
        input.multiple = true;
    }
    return new Promise<FileList | null>((resolve) => {
        input.onchange = () => {
            resolve(input.files);
        };
        input.oncancel = () => {
            resolve(null);
        };
        input.click();
    });
};

export default showOpenFilePicker;
