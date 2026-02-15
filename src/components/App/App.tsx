import style from './style.module.scss';

import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SettingsPane from '../SettingsList/SettingsList';
import TabbedPanel from '../TabbedPanel/TabbedPanel';
import RenderSettingsPane from '../RenderSettingsPane/RenderSettingsPane';
import {useEffect, useState} from 'preact/hooks';
import ResizablePanel from '../ResizablePanel/ResizablePanel';
import DisclaimerModal from '../DisclaimerModal/DisclaimerModal';

const App = () => {
    // I would've liked to use useSignal here but it can't take an initializer function
    const [isPortrait, setIsPortrait] = useState(() => window.matchMedia('(orientation: portrait)').matches);

    useEffect(() => {
        const mediaQueryList = window.matchMedia('(orientation: portrait)');

        const handleOrientationChange = (event: MediaQueryListEvent) => {
            setIsPortrait(event.matches);
        };

        mediaQueryList.addEventListener('change', handleOrientationChange);
        return () => {
            mediaQueryList.removeEventListener('change', handleOrientationChange);
        };
    }, [isPortrait]);

    return <div className={style.app}>
        <ResizablePanel
            className={style.sidePanel}
            initialSize={500}
            minSize={isPortrait ? 200 : 400}
            maxSize={isPortrait ? '75vh' : '75vw'}
            edge={isPortrait ? 'top' : 'right'}
        >
            <TabbedPanel
                tabs={[
                    {
                        id: 'effect-settings',
                        panel: <SettingsPane />,
                        title: 'Effect',
                    },
                    {
                        id: 'render-settings',
                        panel: <RenderSettingsPane />,
                        title: 'Render',
                    },
                ]}
                initialTab="effect-settings"
                className={style.settingsSidebar}
            />
        </ResizablePanel>
        <div className={style.displayPane}>
            <VideoPlayer />
        </div>
        <DisclaimerModal />
    </div>;
};

export default App;
