const Loader = ({progress, size = 100, className}: {progress?: number; size?: number; className?: string}) => {
    const STROKE_WIDTH = Math.min(size / 10, 10);
    const radius = (size - STROKE_WIDTH) * 0.5;
    const circumference = 2 * Math.PI * radius;

    let dashArray, dashOffset;
    if (typeof progress === 'number') {
        progress = Math.max(0, Math.min(1, progress));
        dashArray = circumference;
        dashOffset = circumference - (progress * circumference);
    } else {
        dashArray = circumference / 2;
        dashOffset = 0;
    }

    const spinnerStyle = typeof progress !== 'number' ? {
        animation: 'spin 1.5s linear infinite',
    } : undefined;

    return (
        <svg xmlns="http://www.w3.org/2000/svg" className={className} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <style>{`
                @keyframes spin {
                    from {
                        stroke-dashoffset: ${circumference};
                    }
                    to {
                        stroke-dashoffset: 0;
                    }
                }
            `}</style>
            {typeof progress === 'number' && size >= 64 &&
                <text
                    x="50%"
                    y="50%"
                    text-anchor="middle"
                    dy=".3em"
                    font-size={`${size * 0.2}px`}
                    font-weight={600}
                    fill="currentColor"
                    className="tabular-nums"
                >
                    {Math.round(progress * 100)
                        .toString()
                        .padStart(2, '0') + '%'}
                </text>
            }
            <circle
                cx="50%"
                cy="50%"
                r={radius}
                stroke-width={STROKE_WIDTH}
                stroke="currentColor"
                fill="none"
                stroke-dasharray={dashArray}
                stroke-dashoffset={dashOffset}
                style={spinnerStyle}
            />
        </svg>
    );
};

export default Loader;
