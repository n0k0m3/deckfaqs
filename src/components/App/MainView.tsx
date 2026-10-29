import { useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { Guide } from '../Guide/Guide';
import { GameList } from '../List/GameList';
import { GuideList } from '../List/GuideList';
import { ResultList } from '../List/ResultList';
import { DownloadStatus } from '../Offline/Download';
import { OfflineList } from '../Offline/OfflineList';

export const MainView = () => {
    const {
        state: { pluginState, download },
    } = useContext(AppContext);
    const elementToRender = () => {
        switch (pluginState) {
            case 'games':
                return <GameList />;
            case 'results':
                return <ResultList />;
            case 'guides':
                return <GuideList />;
            case 'guide':
                return <Guide />;
            case 'offline':
                return <OfflineList />;
        }
    };

    // The download uses the hidden browser view, so online browsing waits until it ends
    return useMemo(
        () => (download ? <DownloadStatus /> : elementToRender()),
        [pluginState, !download]
    );
};
