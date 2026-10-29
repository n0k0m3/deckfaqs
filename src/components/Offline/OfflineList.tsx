import {
    ConfirmModal,
    DialogButton,
    Focusable,
    PanelSectionRow,
    showModal,
} from '@decky/ui';
import { useContext, useEffect } from 'react';
import { FaTrash } from 'react-icons/fa';
import { AppContext } from '../../context/AppContext';
import {
    deleteSavedGuide,
    forgetOfflineGuide,
    loadOfflinePage,
    SavedGuide,
} from '../../offline';
import { ActionType } from '../../reducers/AppReducer';
import { refreshSavedGuides } from './Download';

const formatSize = (bytes = 0) =>
    bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.ceil(bytes / 1024)} KB`;

export const OfflineList = () => {
    const {
        state: { savedGuides, isLoading },
        dispatch,
    } = useContext(AppContext);

    useEffect(() => {
        refreshSavedGuides(dispatch);
    }, []);

    const openGuide = async (guide: SavedGuide) => {
        dispatch({
            type: ActionType.UPDATE_PLUGIN_STATE,
            payload: { pluginState: 'guide', isLoading: true },
        });
        let page = { html: '', toc: [] as any[], images: {} };
        try {
            page = await loadOfflinePage(guide.id);
        } catch (e) {}
        dispatch({
            type: ActionType.UPDATE_GUIDE,
            payload: {
                guideHtml: page.html,
                guideToc: page.toc,
                images: page.images,
                guideUrl: guide.url,
                title: guide.title,
                game: guide.game,
                offlineId: guide.id,
            },
        });
    };

    const confirmDelete = (guide: SavedGuide) => {
        showModal(
            <ConfirmModal
                strTitle="Delete offline guide?"
                strDescription={`${guide.game ?? ''} ${guide.title}`.trim()}
                strOKButtonText="Delete"
                bDestructiveWarning={true}
                onOK={async () => {
                    await deleteSavedGuide(guide.id).catch(() => {});
                    forgetOfflineGuide(guide.id);
                    refreshSavedGuides(dispatch);
                }}
            />
        );
    };

    if (isLoading) {
        return (
            <div className="lds-ring">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
        );
    }

    return (
        <div style={{ height: '100%' }}>
            <div
                style={{
                    fontSize: '16px',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    display: 'inline-block',
                    width: '100%',
                }}
            >
                Offline Guides
            </div>
            {savedGuides.map((guide) => (
                <PanelSectionRow key={guide.id}>
                    <Focusable
                        style={{ display: 'flex', margin: '4px 0' }}
                        flow-children="horizontal"
                    >
                        <DialogButton
                            //@ts-ignore
                            disableNavSounds={true}
                            style={{
                                flexGrow: 1,
                                minWidth: 0,
                                textAlign: 'left',
                                marginRight: '5px',
                            }}
                            onClick={() => openGuide(guide)}
                        >
                            {guide.game && (
                                <div style={{ fontSize: '12px', opacity: 0.7 }}>
                                    {guide.game}
                                </div>
                            )}
                            <div>{guide.title}</div>
                            <div style={{ fontSize: '12px', opacity: 0.7 }}>
                                {guide.pageCount} pages, {formatSize(guide.size)}
                            </div>
                        </DialogButton>
                        <DialogButton
                            //@ts-ignore
                            disableNavSounds={true}
                            style={{ minWidth: 0, width: '48px', padding: 0 }}
                            aria-label="Delete offline guide"
                            onClick={() => confirmDelete(guide)}
                        >
                            <FaTrash />
                        </DialogButton>
                    </Focusable>
                </PanelSectionRow>
            ))}
            {savedGuides.length == 0 && (
                <p>
                    No offline guides. Open a guide and press the download
                    button to save it.
                </p>
            )}
        </div>
    );
};
