const formatTimestamp = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    let result: string;
    if (hours > 0) {
        result = `${hours}:${minutes.toString().padStart(2, '0')}` +
            `:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
    } else {
        result = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
    }

    return result;
};

export default formatTimestamp;
