import {useRegisterSW} from 'virtual:pwa-register/preact';
import {useEffect} from 'preact/hooks';

import {useAddToast} from '../Toast/Toast';
import {Motif} from '../../util/motif';

import style from './style.module.scss';
import {Button} from '../Widgets/Widgets';

export default function PwaUpdatePrompt() {
    const {
        needRefresh: [needRefresh],
        offlineReady: [offlineReady],
        updateServiceWorker,
    } = useRegisterSW();

    const addToast = useAddToast();

    useEffect(() => {
        if (offlineReady) {
            addToast({
                motif: Motif.SUCCESS,
                title: 'Ready to work offline',
                timeout: 4000,
            });
        }
    }, [offlineReady]);

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
