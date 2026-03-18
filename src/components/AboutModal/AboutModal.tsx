/* eslint-disable @stylistic/max-len */
import style from './style.module.scss';

import Modal from '../Modal/Modal';
import {Button} from '../Widgets/Widgets';

const AboutModal = ({
    onClose,
    onShowCredits,
}: {
    onClose: () => void;
    onShowCredits: () => void;
}) => {
    return (
        <Modal
            onClose={onClose}
            className={style.aboutModal}
            title="ntsc-rs (web version)"
        >
            <p>
                by <a href="https://github.com/valadaptive/">valadaptive</a>
            </p>
            <p>
                ...loosely based on <a href="https://github.com/JargeZ/ntscqt/">JargeZ/ntscqt</a>
            </p>
            <p>
                ...which is a GUI for <a href="https://github.com/zhuker/ntsc/">zhuker/ntsc</a>
            </p>
            <p>
                ...which is a port of <a href="https://github.com/joncampbell123/composite-video-simulator/">joncampbell123/composite-video-simulator</a>
            </p>
            <p>
                For the desktop version (with lossless output, interlaced video support, faster rendering, and more), visit <a
                    href="https://ntsc.rs"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    ntsc.rs
                </a>.
            </p>
            <p>
                <Button onClick={onShowCredits}>
                    View third-party licenses
                </Button>
            </p>
        </Modal>
    );
};

export default AboutModal;
