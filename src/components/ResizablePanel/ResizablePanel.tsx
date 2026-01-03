import {ComponentChildren} from 'preact';
import useResizablePanel from '../../util/resizable-panel';
import style from './style.module.scss';
import classNames from 'clsx';

const ResizablePanel = ({
    initialSize,
    minSize,
    maxSize,
    edge,
    children,
    className,
}: {
    initialSize: number,
    minSize: number,
    maxSize: number,
    edge: 'top' | 'bottom' | 'left' | 'right',
    children?: ComponentChildren,
    className?: string,
}) => {
    const isVertical = edge === 'top' || edge === 'bottom';
    const {resizerRef, panelRef, panelSize} = useResizablePanel(
        initialSize,
        minSize,
        maxSize,
        edge,
    );

    return <div
        className={classNames(
            style.resizablePanel,
            isVertical ? style.vertical : style.horizontal,
            edge === 'top' && style.topEdge,
            edge === 'bottom' && style.bottomEdge,
            edge === 'left' && style.leftEdge,
            edge === 'right' && style.rightEdge,
            className,
        )}
        ref={panelRef}
        style={{[isVertical ? 'height' : 'width']: `${panelSize.value}px`}}
    >
        <div className={style.splitter} ref={resizerRef} />
        {children}
    </div>;
};

export default ResizablePanel;
