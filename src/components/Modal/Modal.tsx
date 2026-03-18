import type {JSX, ComponentChildren} from 'preact';
import style from './style.module.scss';
import classnames from 'clsx';
import Icon, {IconButton, IconType} from '../Icon/Icon';
import {useId} from 'preact/hooks';

const Modal = ({onClose, title, icon, children, className}: {
    onClose?: (event: Event) => unknown;
    title: string;
    icon?: IconType;
    children: ComponentChildren;
    className?: string;
}): JSX.Element => {
    const titleId = useId();

    return (
        <div className={style.modalWrapper}>
            <div className={style.modalBg} onClick={onClose} />
            <div className={style.modalPositioner}>
                <div
                    className={classnames(style.modal, className)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                >
                    <header className={style.modalHeader}>
                        <div className={style.modalHeaderLeft}>
                            {icon && <Icon type={icon} title="" size="1em" />}
                            <span className={style.modalTitle} id={titleId}>{title}</span>
                        </div>
                        {onClose &&
                            <IconButton type="close" title="Close" onClick={onClose} className={style.closeButton} />}
                    </header>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
