import {render} from 'preact';

import 'valadaptive-lib/css/fonts.css';
import 'valadaptive-lib/css/global.css';
import 'valadaptive-lib/css/buttons.css';
import 'valadaptive-lib/css/theme.css';

import AppInner from './components/App/App';
import {AppContext, AppState} from './app-state';
import {OverlayProvider} from 'valadaptive-lib/Overlay';
import {ToastProvider} from 'valadaptive-lib/Toast';
import {ContextMenuProvider} from 'valadaptive-lib/ContextMenu';
import PwaUpdatePrompt from './components/PwaUpdatePrompt/PwaUpdatePrompt';

const store = new AppState();

export function App() {
    return (
        <AppContext.Provider value={store}>
            <OverlayProvider>
                <ContextMenuProvider>
                    <ToastProvider>
                        <PwaUpdatePrompt />
                        <AppInner />
                    </ToastProvider>
                </ContextMenuProvider>
            </OverlayProvider>
        </AppContext.Provider>
    );
}

document.body.className = '';
render(<App />, document.body);
