import type {JSX, ComponentChildren} from 'preact';
import style from './style.module.scss';
import classnames from 'clsx';

const Modal = ({onClose, children, className}: {
    onClose: (event: Event) => unknown;
    children: ComponentChildren;
    className?: string;
}): JSX.Element => {
    return (
        <div className={style.modalWrapper}>
            <div className={style.modalBg} onClick={onClose} />
            <div className={style.modalPositioner}>
                <div className={classnames(style.modal, className)}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
