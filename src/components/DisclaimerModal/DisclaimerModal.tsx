/* eslint-disable @stylistic/max-len */
import style from './style.module.scss';

import {useCallback} from 'preact/hooks';
import {useAppState} from '../../app-state';
import Modal from '../Modal/Modal';
import {Button, LinkButton} from '../Widgets/Widgets';

const DisclaimerModal = () => {
    const {disclaimerModalOpen} = useAppState();
    const onModalClose = useCallback(() => {
        disclaimerModalOpen.value = false;
    }, [disclaimerModalOpen]);

    if (!disclaimerModalOpen.value) return null;

    return <Modal onClose={onModalClose} className={style.disclaimerModal}>
        <h1>Web Version Limitations</h1>

        This is the <strong>experimental</strong> web version of ntsc-rs. It runs entirely in your browser, which makes it convenient, but it comes with some limitations compared to <a href="https://ntsc.rs">the desktop version</a>:

        <h2>Video output</h2>

        <ul>
            <li>No interlaced output. The web video encoding APIs don't support interlacing.</li>
            <li>No lossless output. Browsers only support lossy video formats.</li>
            <li>No integration with other video editing software. The desktop version comes in plugin form, and works with a wide variety of video editing software.</li>
        </ul>

        <h2>Performance</h2>

        <ul>
            <li>Slower effect rendering. The effect itself is around 1.5x as slow as the desktop version.</li>
            <li>Firefox (and possibly Safari) render slower than Chrome. These browsers simply chose a slower video encoding preset, and there is no way to control the encoding speed. Prefer Chrome if possible.</li>
        </ul>

        <h2>Mobile-specific pitfalls</h2>

        <p>
            Mobile devices, and videos recorded on them, have their own quirks and limitations.
        </p>

        <ul>
            <li><strong>You cannot render videos in the background!</strong> Mobile browsers will aggressively unload background tabs, which will interrupt any ongoing render. Keep your browser in the foreground while rendering.</li>
            <li>
                <p><strong>Videos recorded on phones will do weird things!</strong> These videos often have many quirks that affect playback and editing.</p>

                <p>These quirks include variable framerates, weird camera rotation metadata, invalid/negative timestamps, and invalid metadata that may cause issues when seeking.</p>

                <p>While these issues also affect the desktop version of ntsc-rs, they are important to mention here because this is the only version of ntsc-rs that runs <em>on</em> a phone itself.</p>
            </li>
        </ul>

        <p className={style.buttons}>
            <LinkButton target="_blank" href="https://ntsc.rs/download">Download desktop version</LinkButton>
            <Button onClick={onModalClose}>Continue</Button>
        </p>
    </Modal>;
};

export default DisclaimerModal;
