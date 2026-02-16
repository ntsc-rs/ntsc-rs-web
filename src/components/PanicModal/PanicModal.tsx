import style from './style.module.scss';

import {useAppState} from '../../app-state';
import Modal from '../Modal/Modal';
import Icon from '../Icon/Icon';

const PanicModal = () => {
    const {panicMessage} = useAppState();
    if (panicMessage.value === null) return null;

    return <Modal className={style.panicModal}>
        <h1 className={style.header}>
            <Icon type="error" title="" size="1em" />
            <span>An internal error occurred</span>
        </h1>
        <p className={style.pleaseReload}>
            Please reload the page.
        </p>
        <pre>
            {panicMessage.value}
        </pre>
    </Modal>;
};

export default PanicModal;
