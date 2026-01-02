import style from './style.module.scss';

import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SettingsPane from '../SettingsList/SettingsList';
import TabbedPanel from '../TabbedPanel/TabbedPanel';
import RenderSettingsPane from '../RenderSettingsPane/RenderSettingsPane';

const App = () => {
    return <div className={style.app}>
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
        <div className={style.displayPane}>
            <VideoPlayer />
        </div>
    </div>;
};

export default App;
