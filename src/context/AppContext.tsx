import React, { createContext, useReducer } from 'react';
import { ListItem } from '../components/List/List';
import { DownloadProgress, SavedGuide } from '../offline';
import { AppActions, appReducer } from '../reducers/AppReducer';

export type PluginState = 'games' | 'results' | 'guides' | 'guide' | 'offline';

export type TableOfContentEntry = {
    data: any;
    label: string;
};

export type GuideContents = {
    guideUrl?: string;
    guideHtml?: string;
    guideToc?: Array<TableOfContentEntry>;
    currentTocSection?: any;
    anchor?: string;
    title?: string;
    game?: string;
    // Set when the guide comes from local storage
    offlineId?: string;
    // Maps an image src to a data URL for offline guides
    images?: Record<string, string>;
};

export type GuideSearch = {
    searchText: string;
    searchAnchorLength: number;
    anchorIndex: number;
};

export const initSearchState: GuideSearch = {
    searchText: '',
    searchAnchorLength: 0,
    anchorIndex: -1,
};

export type TAppState = {
    pluginState: PluginState;
    games: ListItem[];
    searchResults: ListItem[];
    guides: ListItem[];
    runningGame?: string;
    darkMode: boolean;
    isLoading: boolean;
    currentGuide?: GuideContents;
    search: GuideSearch;
    browserView: any;
    currentGame?: string;
    savedGuides: SavedGuide[];
    download?: DownloadProgress & { title: string };
};

type TAppContext = {
    state: TAppState;
    dispatch: React.Dispatch<AppActions>;
    browserView: any;
};

export const initialState: TAppState = {
    pluginState: 'games',
    games: [],
    searchResults: [],
    guides: [],
    runningGame: undefined,
    currentGuide: undefined,
    darkMode: false,
    isLoading: false,
    search: initSearchState,
    browserView: undefined,
    currentGame: undefined,
    savedGuides: [],
    download: undefined,
};

export const AppContext = createContext<TAppContext>({
    state: initialState,
    dispatch: () => {},
    browserView: undefined,
});

type AppContextProps = {
    children?: React.ReactNode;
    incomingState?: TAppState;
    browserView: any;
};

// This might be kind of overkill but figured why not try non-Redux state management
export const AppContextProvider: React.FC<AppContextProps> = ({
    children,
    incomingState,
    browserView,
}) => {
    const myState = {
        ...initialState,
        ...incomingState,
    };
    const [state, dispatch] = useReducer(appReducer, myState);
    const value = { state, browserView, dispatch };
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
