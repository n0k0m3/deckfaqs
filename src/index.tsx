import { definePlugin, routerHook } from '@decky/api';
import { Router, staticClasses } from '@decky/ui';
import { FaSearch } from 'react-icons/fa';
import { App } from './components/App/App';
import { AppContextProvider } from './context/AppContext';

export default definePlugin(() => {
    const windowRouter = Router.WindowStore?.GamepadUIMainWindowInstance;
    // @ts-ignore
    const browserView = windowRouter?.CreateBrowserView('DeckFAQs Offline');
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
            SteamClient.BrowserView.Destroy(browserView);
            routerHook.removeRoute('/deckfaqs-offline-fullscreen');
        },
        alwaysRender: true,
    };
});
