const UNITS = [' bytes', 'KB', 'MB', 'GB'];
const DIVISOR = 1000;

const formatFileSize = (bytes: number): string => {
    let unitIndex = 0;
    let sizeInUnits = bytes;
    while (sizeInUnits > DIVISOR && unitIndex < UNITS.length) {
        sizeInUnits /= DIVISOR;
        unitIndex++;
    }
    const fixedUnits = unitIndex < 2 ? sizeInUnits.toFixed(0) : sizeInUnits.toFixed(2);
    return `${fixedUnits} ${UNITS[unitIndex]}`;
};

export default formatFileSize;
