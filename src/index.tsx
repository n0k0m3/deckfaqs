import { definePlugin, routerHook } from '@decky/api';
import { Router, staticClasses } from '@decky/ui';
import { FaSearch } from 'react-icons/fa';
import { App } from './components/App/App';
import { AppContextProvider } from './context/AppContext';

export default definePlugin(() => {
    // Created on first use: when Steam starts in desktop mode, the gamepad window does not exist yet
    let view: any;
    const browserView = {
        LoadURL(url: string) {
            const steamWindow = Router.WindowStore
                ?.GamepadUIMainWindowInstance as any;
            view ??= steamWindow?.CreateBrowserView('DeckFAQs Offline');
            view?.LoadURL(url);
        },
    };
    return {
        name: 'DeckFAQs Offline',
        titleView: <div className={staticClasses.Title}>DeckFAQs Offline</div>,
        content: (
            <AppContextProvider browserView={browserView}>
                <App />
            </AppContextProvider>
        ),
        icon: <FaSearch />,
        onDismount() {
            // SteamClient.BrowserView.Destroy no longer closes the view on current Steam builds
            view?.Destroy?.();
            routerHook.removeRoute('/deckfaqs-offline-fullscreen');
        },
        alwaysRender: true,
    };
});
