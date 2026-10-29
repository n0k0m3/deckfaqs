import { fetchNoCors } from '@decky/api';

// Steam's CEF pages (tabs), and the results of executeInTab in them

const TAB_LIST_TIMEOUT_MS = 5_000;
// Polls while a page loads; each poll retries, so one lost reply costs little
export const POLL_EVAL_TIMEOUT_MS = 4_000;

// Decky 3 returns { success, result: value } from executeInTab.
// Decky 2 wraps that object in one more { success, result } layer.
export const unwrapTabResult = (response: any): { ok: boolean; value: any } => {
    let res = response;
    if (
        res?.result &&
        typeof res.result === 'object' &&
        'success' in res.result
    ) {
        if (!res.success) return { ok: false, value: undefined };
        res = res.result;
    }
    return { ok: !!res?.success, value: res?.result };
};

// A Decky round trip can lose its reply; without a limit the caller waits forever
export const withTimeout = async <T>(
    promise: Promise<T>,
    ms: number,
    message: string
): Promise<T> => {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        window.clearTimeout(timer);
    }
};

// executeInTab finds a tab by title. While the view switches pages, the tab already has the new
// URL but still the blank page's title, and a call then goes to the renderer being replaced.
export const isLoadedTab = (tab: any): boolean =>
    !!tab?.title && !tab.title.startsWith('data:');

// Lists Steam's CEF pages. The hidden browser view is one of them.
export const listSteamTabs = async (): Promise<Array<any>> => {
    try {
        const response = await withTimeout(
            fetchNoCors('http://localhost:8080/json'),
            TAB_LIST_TIMEOUT_MS,
            'Steam did not list its tabs'
        );
        return response.ok ? await response.json() : [];
    } catch (e) {
        return [];
    }
};
