import style from './style.module.scss';

import {useAppState} from '../../app-state';

import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SettingsPane from '../SettingsList/SettingsList';

const App = () => {
    const store = useAppState();

    return <div className={style.app}>
        <div className={style.settingsSidebar}>
            <SettingsPane />
        </div>
        <div className={style.displayPane}>
            <VideoPlayer />
        </div>
    </div>;
};

export default App;
