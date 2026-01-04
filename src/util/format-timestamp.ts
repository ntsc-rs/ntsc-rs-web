const hms = <T>(seconds: number, cb: (hours: number, minutes: number, seconds: number) => T) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return cb(hours, minutes, remainingSeconds);
};

const formatTimestamp = (seconds: number) => {
    return hms(seconds, (hours, minutes, seconds) => {
        let result: string;
        if (hours > 0) {
            result = `${hours}:${minutes.toString().padStart(2, '0')}` +
                `:${seconds.toFixed(2).padStart(5, '0')}`;
        } else {
            result = `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
        }

        return result;
    });
};

const plural = (n: number) => n === 1 ? '' : 's';
const formatTimestampHuman = (seconds: number) => {
    return hms(seconds, (hours, minutes, seconds) => {
        let result = '';
        if (hours > 0) {
            result += `${hours} hour${plural(hours)}, `;
        }
        if (minutes > 0) {
            result += `${minutes} minute${plural(minutes)}, `;
        }
        result += `${seconds} second${plural(seconds)}`;

        return result;
    });
};

const parseTimestamp = (timestamp: string): number | null => {
    const parts = timestamp.split(':');
    let seconds = 0;
    if (parts.length > 3) return null;
    for (const part of parts) {
        const numPart = Number(part);
        if (!Number.isFinite(numPart) || numPart < 0) {
            return null;
        }
        seconds *= 60;
        seconds += numPart;
    }

    return seconds;
};

export {formatTimestamp, formatTimestampHuman, parseTimestamp};
