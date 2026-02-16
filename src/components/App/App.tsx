import style from './style.module.scss';

import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SettingsPane from '../SettingsList/SettingsList';
import TabbedPanel from '../TabbedPanel/TabbedPanel';
import RenderSettingsPane from '../RenderSettingsPane/RenderSettingsPane';
import ResizablePanel from '../ResizablePanel/ResizablePanel';
import DisclaimerModal from '../DisclaimerModal/DisclaimerModal';
import {useAppState} from '../../app-state';
import PanicModal from '../PanicModal/PanicModal';

const App = () => {
    const {isPortrait} = useAppState();

    return <div className={style.app}>
        <ResizablePanel
            className={style.sidePanel}
            initialSize={500}
            minSize={isPortrait.value ? 200 : 400}
            maxSize={isPortrait.value ? '75vh' : '75vw'}
            edge={isPortrait.value ? 'top' : 'right'}
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
        <PanicModal />
    </div>;
};

export default App;
