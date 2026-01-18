import {render} from 'preact';

import './css/fonts.css';
import './css/global.scss';
import './css/buttons.scss';

import AppInner from './components/App/App';
import {AppContext, AppState} from './app-state';
import {OverlayProvider} from './components/Overlay/Overlay';
import {ToastProvider} from './components/Toast/Toast';
import {ContextMenuProvider} from './components/Widgets/Widgets';

const store = new AppState();

export function App() {

    return (
        <AppContext.Provider value={store}>
            <OverlayProvider>
                <ContextMenuProvider>
                    <ToastProvider>
                        <AppInner />
                    </ToastProvider>
                </ContextMenuProvider>
            </OverlayProvider>
        </AppContext.Provider>
    );
}

document.body.className = '';
render(<App />, document.body);
