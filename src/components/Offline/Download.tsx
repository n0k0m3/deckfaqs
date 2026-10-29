import {
    DialogButton,
    PanelSection,
    PanelSectionRow,
    ProgressBarWithInfo,
} from '@decky/ui';
import { toaster } from '@decky/api';
import React, { useContext } from 'react';
import { FaCheck, FaDownload } from 'react-icons/fa';
import { AppContext } from '../../context/AppContext';
import {
    downloadGuide,
    guideIdFromUrl,
    listSavedGuides,
} from '../../offline';
import { ActionType, AppActions } from '../../reducers/AppReducer';

// The download continues when the user leaves the guide, so the cancel flag is not component state
let cancelRequested = false;

export const refreshSavedGuides = async (
    dispatch: React.Dispatch<AppActions>
) => {
    try {
        dispatch({
            type: ActionType.UPDATE_SAVED_GUIDES,
            payload: await listSavedGuides(),
        });
    } catch (e) {}
};

const startDownload = async (
    guide: { url: string; title: string; game?: string },
    browserView: any,
    dispatch: React.Dispatch<AppActions>
) => {
    cancelRequested = false;
    dispatch({
        type: ActionType.UPDATE_DOWNLOAD,
        payload: { title: guide.title, done: 0, total: 1, label: '' },
    });
    try {
        const saved = await downloadGuide(
            guide,
            browserView,
            (progress) =>
                dispatch({
                    type: ActionType.UPDATE_DOWNLOAD,
                    payload: { ...progress, title: guide.title },
                }),
            () => cancelRequested
        );
        toaster.toast({
            title: 'Guide saved for offline use',
            body: `${saved.title}: ${saved.pageCount} pages, ${saved.imageCount} images`,
        });
    } catch (e: any) {
        toaster.toast({
            title: 'Guide download failed',
            body: e?.message ?? String(e),
        });
    }
    dispatch({ type: ActionType.UPDATE_DOWNLOAD, payload: undefined });
    await refreshSavedGuides(dispatch);
};

export const DownloadButton = ({
    style,
}: { style?: React.CSSProperties }) => {
    const {
        state: { currentGuide, savedGuides },
        dispatch,
        browserView,
    } = useContext(AppContext);
    const url = currentGuide?.guideUrl;
    const id = url && guideIdFromUrl(url);
    if (!url || !id || currentGuide?.offlineId) return null;
    const saved = savedGuides.some((guide) => guide.id === id);
    return (
        <DialogButton
            //@ts-ignore
            disableNavSounds={true}
            style={style}
            aria-label={saved ? 'Update offline copy' : 'Download for offline use'}
            onClick={() =>
                startDownload(
                    {
                        url,
                        title: currentGuide?.title ?? `Guide ${id}`,
                        game: currentGuide?.game,
                    },
                    browserView,
                    dispatch
                )
            }
        >
            {saved ? (
                <FaCheck style={{ margin: '0 auto', display: 'block' }} />
            ) : (
                <FaDownload style={{ margin: '0 auto', display: 'block' }} />
            )}
        </DialogButton>
    );
};

export const DownloadStatus = () => {
    const {
        state: { download },
    } = useContext(AppContext);
    if (!download) return null;
    const percent =
        download.total > 0 ? (100 * download.done) / download.total : 0;
    return (
        <PanelSection title={`Saving ${download.title}`}>
            <PanelSectionRow>
                <ProgressBarWithInfo
                    nProgress={percent}
                    sOperationText={download.label}
                />
            </PanelSectionRow>
            <PanelSectionRow>
                <DialogButton
                    onClick={() => {
                        cancelRequested = true;
                    }}
                >
                    Cancel
                </DialogButton>
            </PanelSectionRow>
        </PanelSection>
    );
};
