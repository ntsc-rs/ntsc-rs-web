import './style.scss';

import type {JSX} from 'preact';
import classNames from 'clsx';

import {Motif} from '../../util/motif';

export type IconType =
    | 'arrow-down'
    | 'arrow-right'
    | 'arrow-up'
    | 'arrow-left'
    | 'check'
    | 'close'
    | 'copy'
    | 'download'
    | 'effect'
    | 'error'
    | 'funnel'
    | 'gear'
    | 'github'
    | 'globe'
    | 'link'
    | 'paste'
    | 'pause'
    | 'play'
    | 'pin'
    | 'plus'
    | 'range'
    | 'reset'
    | 'search'
    | 'speaker'
    | 'speaker-mute'
    | 'stack'
    | 'upload'
    | 'warning';

const Icon = ({type, title, size, motif, className, clickableStyle}: {
    type: IconType;
    title: string | null;
    size?: string | number;
    motif?: Motif;
    className?: string;
    clickableStyle?: boolean;
}): JSX.Element => {
    const cssSize = typeof size === 'string' ? size : typeof size === 'number' ? `${size}px` : undefined;
    const inlineStyle = cssSize ? {
        width: cssSize,
        height: cssSize,
    } : undefined;
    return (
        <div
            className={classNames(
                'icon',
                `icon-${type}`,
                {
                    'motif-primary': motif === Motif.PRIMARY,
                    'motif-success': motif === Motif.SUCCESS,
                    'motif-warning': motif === Motif.WARNING,
                    'motif-error': motif === Motif.ERROR,
                    'motif-monochrome': motif === Motif.MONOCHROME,
                    'icon-clickable': clickableStyle,
                },
                className,
            )}
            style={inlineStyle}
            title={title ?? undefined}
        />
    );
};

export default Icon;

export const IconButton = ({
    type,
    title,
    size,
    onClick,
    disabled,
    motif,
    className,
}: {
    type: IconType;
    title: string;
    size?: string | number;
    onClick?: (event: MouseEvent) => unknown;
    disabled?: boolean;
    motif?: Motif;
    className?: string;
}): JSX.Element => {
    return (
        <button
            className={classNames(
                'icon-button',
                {
                    'icon-disabled': disabled,
                    'motif-primary': motif === Motif.PRIMARY,
                    'motif-success': motif === Motif.SUCCESS,
                    'motif-warning': motif === Motif.WARNING,
                    'motif-error': motif === Motif.ERROR,
                    'motif-monochrome': motif === Motif.MONOCHROME,
                },
                className,
            )}
            onClick={disabled ? undefined : onClick}
            title={title}
            disabled={disabled}
            tabIndex={0}
        >
            <Icon
                type={type}
                title={null}
                size={size}
                motif={motif}
            />
        </button>
    );
};
