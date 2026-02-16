import style from './style.module.scss';

import {useSignal} from '@preact/signals';
import {useCallback, useMemo, useRef} from 'preact/hooks';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SettingsPane from '../SettingsList/SettingsList';
import TabbedPanel from '../TabbedPanel/TabbedPanel';
import RenderSettingsPane from '../RenderSettingsPane/RenderSettingsPane';
import ResizablePanel from '../ResizablePanel/ResizablePanel';
import DisclaimerModal from '../DisclaimerModal/DisclaimerModal';
import {useAppState} from '../../app-state';
import PanicModal from '../PanicModal/PanicModal';
import AboutModal from '../AboutModal/AboutModal';
import CreditsModal from '../CreditsModal/CreditsModal';
import {ContextMenuItem, Menu, ToggleIcon} from '../Widgets/Widgets';
import {Overlay} from '../Overlay/Overlay';

const App = () => {
    const {isPortrait} = useAppState();
    const aboutOpen = useSignal(false);
    const creditsOpen = useSignal(false);

    const openAbout = useCallback(() => {
        aboutOpen.value = true;
    }, [aboutOpen]);

    const closeAbout = useCallback(() => {
        aboutOpen.value = false;
    }, [aboutOpen]);

    const showCredits = useCallback(() => {
        aboutOpen.value = false;
        creditsOpen.value = true;
    }, [aboutOpen, creditsOpen]);

    const closeCredits = useCallback(() => {
        creditsOpen.value = false;
    }, [creditsOpen]);

    const navMenuItems: ContextMenuItem[] = useMemo(() => {
        return [
            {
                id: 'about',
                label: 'About',
                onClick: openAbout,
            },
            {
                id: 'home',
                label: 'Homepage',
                href: 'https://ntsc.rs',
            },
        ];
    }, []);

    const navMenuRef = useRef<HTMLButtonElement>(null);
    const navMenuOpen = useSignal(false);

    const closeNav = useCallback(() => {
        navMenuOpen.value = false;
    }, [navMenuOpen]);

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
                auxiliaryItems={
                    <ToggleIcon
                        type="menu"
                        title="Navigation"
                        toggled={navMenuOpen}
                        innerRef={navMenuRef}
                    />
                }
            />
        </ResizablePanel>
        {navMenuOpen.value && navMenuRef.current &&
            <Overlay>
                <Menu
                    refElement={navMenuRef.current}
                    items={navMenuItems}
                    onClose={closeNav}
                />
            </Overlay>
        }
        <div className={style.displayPane}>
            <VideoPlayer />
        </div>
        <DisclaimerModal />
        <PanicModal />
        {aboutOpen.value && (
            <AboutModal
                onClose={closeAbout}
                onShowCredits={showCredits}
            />
        )}
        {creditsOpen.value && (
            <CreditsModal onClose={closeCredits} />
        )}
    </div>;
};

export default App;
