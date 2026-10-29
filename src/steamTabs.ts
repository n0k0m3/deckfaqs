import { fetchNoCors } from '@decky/api';

// Steam's CEF pages (tabs), and the results of executeInTab in them

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

// Lists Steam's CEF pages. The hidden browser view is one of them.
export const listSteamTabs = async (): Promise<Array<any>> => {
    try {
        const response = await fetchNoCors('http://localhost:8080/json');
        return response.ok ? await response.json() : [];
    } catch (e) {
        return [];
    }
};
