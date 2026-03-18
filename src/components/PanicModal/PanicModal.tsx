import style from './style.module.scss';

import {useAppState} from '../../app-state';
import Modal from '../Modal/Modal';

const PanicModal = () => {
    const {panicMessage} = useAppState();
    if (panicMessage.value === null) return null;

    return <Modal
        className={style.panicModal}
        title="An internal error occurred"
        icon="error"
    >
        <p className={style.pleaseReload}>
            Please reload the page.
        </p>
        <pre>
            {panicMessage.value}
        </pre>
    </Modal>;
};

export default PanicModal;
