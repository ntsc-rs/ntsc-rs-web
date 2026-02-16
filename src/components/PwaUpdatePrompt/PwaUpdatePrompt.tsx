import {useRegisterSW} from 'virtual:pwa-register/preact';
import {useEffect} from 'preact/hooks';

import {useAddToast} from '../Toast/Toast';
import {Motif} from '../../util/motif';

import style from './style.module.scss';
import {Button} from '../Widgets/Widgets';

// This toast could be overwhelming, since it appears the first time the page is loaded. Not sure yet whether I want to
// keep this or not.
const SHOW_OFFLINE_READY = false;

export default function PwaUpdatePrompt() {
    const {
        needRefresh: [needRefresh],
        offlineReady: [offlineReady],
        updateServiceWorker,
    } = useRegisterSW();

    const addToast = useAddToast();

    useEffect(() => {
        if (offlineReady && SHOW_OFFLINE_READY) {
            addToast({
                motif: Motif.SUCCESS,
                title: 'Ready to work offline',
                timeout: 4000,
            });
        }
    }, [offlineReady, SHOW_OFFLINE_READY]);

    useEffect(() => {
        if (needRefresh) {
            addToast({
                title: 'Update available',
                contents: ({closeToast}) => (
                    <div className={style.updatePrompt}>
                        <p>A new version of the ntsc-rs webapp is available.</p>
                        <div className={style.updateActions}>
                            <Button
                                className='button primary'
                                onClick={() => {
                                    void updateServiceWorker();
                                }}
                            >
                                Reload
                            </Button>
                            <Button
                                className='button'
                                onClick={closeToast}
                            >
                                Later
                            </Button>
                        </div>
                    </div>
                ),
            });
        }
    }, [needRefresh]);

    return null;
}
