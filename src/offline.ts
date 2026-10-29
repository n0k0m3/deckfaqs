import { callable, executeInTab } from '@decky/api';
import DOMPurify from 'dompurify';
import { TableOfContentEntry } from './context/AppContext';
import {
    isLoadedTab,
    listSteamTabs,
    unwrapTabResult,
    withTimeout,
} from './steamTabs';

export type SavedGuide = {
    id: string;
    url: string;
    title: string;
    game?: string;
    savedAt?: number;
    size?: number;
    pageCount?: number;
    imageCount?: number;
};

type GuideMeta = SavedGuide & {
    toc: Array<TableOfContentEntry>;
    pages: string[];
    // Maps an image src in the guide HTML to its file name under images/
    images: Record<string, string>;
};

export type OfflinePage = {
    html: string;
    toc: Array<TableOfContentEntry>;
    images: Record<string, string>;
};

export type DownloadProgress = {
    done: number;
    total: number;
    label: string;
};

// The key of the guide's first page. Real page slugs start with a letter or digit.
export const ROOT_PAGE = '_root';
// Older guides split pages with "?page=N" links. Page N is stored as "_page-N", and page 0 is the root page.
const PAGE_PREFIX = '_page-';
const MAX_PAGES = 500;
// Each websocket message has a 4 MB limit and non-ASCII text can take 4 bytes per character
const CHUNK = 256 * 1024;
const MAX_POLLING = 150;
// Each request inside the GameFAQs tab, and each executeInTab round trip, has a time limit
const FETCH_TIMEOUT_MS = 20_000;
const EVAL_TIMEOUT_MS = 45_000;

export const guideIdFromUrl = (url: string): string | undefined =>
    url.match(/\/faqs\/(\d+)/)?.[1];

// Removes the host and any trailing slash, for example "/ps5/323053-elden-ring/faqs/80028"
const guideRootPath = (url: string): string => {
    const id = guideIdFromUrl(url);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    return path.substring(
        0,
        path.indexOf(`/faqs/${id}`) + `/faqs/${id}`.length
    );
};

// Converts a link or TOC path ("limgrave", "limgrave#boss", "#boss", or an absolute guide path)
// into a stored page key and an anchor
export const offlineTarget = (
    path: string,
    guideUrl: string
): { page: string; anchor?: string } => {
    const [rawPage, anchor] = path.split('#', 2);
    let page = rawPage;
    const root = guideRootPath(guideUrl);
    if (
        page === root ||
        page.startsWith(`${root}/`) ||
        page.startsWith(`${root}?`)
    )
        page = page.substring(root.length);
    page = page.replace(/^\/+|\/+$/g, '');
    const query = page.match(/^\?page=(\d+)$/);
    if (query) page = query[1] === '0' ? '' : PAGE_PREFIX + query[1];
    return { page: page || ROOT_PAGE, anchor: anchor || undefined };
};

// Backend methods in main.py. Each call rejects when the Python method raises.
const beginGuide = callable<[guideId: string], boolean>('begin_guide');
const writeFile = callable<
    [guideId: string, relPath: string, data: string, append: boolean],
    number
>('write_file');
const finishGuide = callable<[guideId: string, meta: object], SavedGuide>(
    'finish_guide'
);
const abortGuide = callable<[guideId: string], boolean>('abort_guide');
const getMeta = callable<[guideId: string], GuideMeta>('get_meta');
const readFile = callable<
    [guideId: string, relPath: string, offset: number],
    { data: string; next: number; eof: boolean }
>('read_file');
export const listSavedGuides = callable<[], SavedGuide[]>('list_guides');
export const deleteSavedGuide = callable<[guideId: string], boolean>(
    'delete_guide'
);

const readAll = async (id: string, relPath: string) => {
    let text = '';
    let offset = 0;
    for (;;) {
        const { data, next, eof } = await readFile(id, relPath, offset);
        text += data;
        if (eof) return text;
        offset = next;
    }
};

const writeAll = async (id: string, relPath: string, text: string) => {
    let offset = 0;
    do {
        let end = Math.min(offset + CHUNK, text.length);
        // Do not split a surrogate pair, because Python cannot encode half of one
        const last = text.charCodeAt(end - 1);
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
        await writeFile(id, relPath, text.substring(offset, end), offset > 0);
        offset = end;
    } while (offset < text.length);
};

const pageFile = (page: string) => `pages/${page}.html`;

const metaCache: Record<string, GuideMeta> = {};

export const loadOfflinePage = async (
    id: string,
    page: string = ROOT_PAGE
): Promise<OfflinePage> => {
    const meta = metaCache[id] ?? (metaCache[id] = await getMeta(id));
    if (!meta.pages.includes(page)) page = ROOT_PAGE;
    const html = DOMPurify.sanitize(await readAll(id, pageFile(page)));
    const images: Record<string, string> = {};
    for (const match of html.matchAll(/<img[^>]*?\ssrc="([^"]+)"/g)) {
        const src = match[1].replace(/&amp;/g, '&');
        const file = meta.images[src];
        if (file && !images[src]) {
            images[src] = await readAll(id, `images/${file}`);
        }
    }
    return { html, toc: meta.toc, images };
};

export const forgetOfflineGuide = (id: string) => {
    delete metaCache[id];
};

// This code runs inside the hidden GameFAQs tab. Same-origin fetch() passes the
// site's bot check, which blocks requests from the Decky backend.
const installCode = (rootPath: string) => `(() => {
    const ROOT = ${JSON.stringify(rootPath)};
    const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
    const PAGE_PREFIX = ${JSON.stringify(PAGE_PREFIX)};
    function parseList(list) {
        let newT = [];
        for (let element of list.children) {
            switch (element.tagName) {
                case 'LI':
                    const a = element.getElementsByTagName('a')[0];
                    if (a) newT.push({ data: a.getAttribute('href'), label: a.textContent });
                    break;
                case 'OL':
                    newT.push({ label: element.previousSibling?.textContent, options: parseList(element) });
                    break;
            }
        }
        return newT;
    }
    function toSlug(href) {
        let page = href.split('#')[0];
        if (page.startsWith(ROOT + '/')) page = page.substring(ROOT.length + 1);
        else if (page.startsWith(ROOT + '?')) page = page.substring(ROOT.length);
        page = page.replace(/\\/+$/, '');
        const query = page.match(/^\\/?\\?page=(\\d+)$/);
        if (query) return query[1] === '0' ? undefined : PAGE_PREFIX + query[1];
        return SLUG.test(page) ? page : undefined;
    }
    function pageUrl(slug) {
        if (!slug) return ROOT;
        if (slug.startsWith(PAGE_PREFIX)) return ROOT + '?page=' + slug.substring(PAGE_PREFIX.length);
        return ROOT + '/' + slug;
    }
    // A request that never answers would hold the whole download
    async function get(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ${FETCH_TIMEOUT_MS});
        try {
            return await fetch(url, { credentials: 'include', signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }
    window.__dfq = {
        store: {},
        async page(slug) {
            let res;
            try {
                res = await get(pageUrl(slug));
            } catch (e) {
                return { ok: false, status: 0 };
            }
            if (!res.ok) return { ok: false, status: res.status };
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const wrap = doc.getElementById('faqwrap');
            if (!wrap) return { ok: false, status: res.status };
            const links = new Set();
            for (const a of wrap.querySelectorAll('a[href]')) {
                const s = toSlug(a.getAttribute('href'));
                if (s) links.add(s);
            }
            const images = new Set();
            for (const img of wrap.querySelectorAll('img[src]')) images.add(img.getAttribute('src'));
            const ol = wrap.querySelector('.ftoc ol');
            const html = wrap.outerHTML;
            this.store.page = html;
            return { ok: true, length: html.length, links: [...links], images: [...images], toc: ol ? parseList(ol) : [] };
        },
        async image(src) {
            try {
                const res = await get(src);
                if (!res.ok) return { ok: false };
                const blob = await res.blob();
                if (!blob.type.startsWith('image/')) return { ok: false };
                const url = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                this.store.image = url;
                return { ok: true, length: url.length };
            } catch (e) {
                return { ok: false };
            }
        },
        chunk(key, start, end) {
            return this.store[key].substring(start, end);
        },
    };
    return true;
})()`;

const delay = (ms: number) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

const evalInTab = async <T>(tab: string, code: string): Promise<T> => {
    const { ok, value } = unwrapTabResult(
        await withTimeout(
            executeInTab(tab, true, code),
            EVAL_TIMEOUT_MS,
            'The GameFAQs tab did not answer'
        )
    );
    if (!ok) throw new Error('Script failed in the GameFAQs tab');
    return value as T;
};

// Decky evaluates without returnByValue, so an object result arrives empty.
// This sends the object across as a JSON string.
const evalJsonInTab = async <T>(tab: string, code: string): Promise<T> =>
    JSON.parse(
        await evalInTab<string>(
            tab,
            `(async () => JSON.stringify(await (${code})))()`
        )
    );

// Loads the guide in the hidden browser view and returns the tab title for executeInTab
const openGuideTab = async (url: string, browserView: any): Promise<string> => {
    const encoded = encodeURI(url);
    browserView.LoadURL(encoded);
    for (let i = 0; i < MAX_POLLING; i++) {
        await delay(200);
        const tab = (await listSteamTabs()).find((a) => a.url === encoded);
        if (!isLoadedTab(tab)) continue;
        try {
            const ready = await evalInTab<boolean>(
                tab.title,
                `document.readyState !== 'loading' && !!document.getElementById('faqwrap')`
            );
            if (ready) return tab.title;
        } catch (e) {}
    }
    throw new Error('GameFAQs did not load. Check the network connection.');
};

const pullFromTab = async (tab: string, key: string, length: number) => {
    let text = '';
    for (let start = 0; start < length; start += CHUNK) {
        text += await evalInTab<string>(
            tab,
            `window.__dfq.chunk(${JSON.stringify(key)}, ${start}, ${
                start + CHUNK
            })`
        );
    }
    return text;
};

const extensionFor = (dataUrl: string) =>
    dataUrl.match(/^data:image\/([a-z0-9+.-]+)/i)?.[1].replace(/\W/g, '') ??
    'img';

// Saves every page and image of a guide. Throws if no page loads or if cancelled() returns true.
export const downloadGuide = async (
    guide: { url: string; title: string; game?: string },
    browserView: any,
    onProgress: (progress: DownloadProgress) => void,
    cancelled: () => boolean
): Promise<SavedGuide> => {
    const id = guideIdFromUrl(guide.url);
    if (!id) throw new Error('This page is not a GameFAQs guide');
    const rootPath = guideRootPath(guide.url);
    const rootUrl = `https://gamefaqs.gamespot.com${rootPath}`;
    const checkCancel = () => {
        if (cancelled()) throw new Error('Download cancelled');
    };

    onProgress({ done: 0, total: 1, label: 'Opening GameFAQs' });
    const tab = await openGuideTab(rootUrl, browserView);
    try {
        await evalInTab(tab, installCode(rootPath));
        await beginGuide(id);

        const queue = [''];
        const seen = new Set(queue);
        const pages: string[] = [];
        const imageSrcs = new Set<string>();
        let toc: Array<TableOfContentEntry> = [];
        let failed = 0;
        while (queue.length > 0 && pages.length < MAX_PAGES) {
            checkCancel();
            const slug = queue.shift()!;
            onProgress({
                done: pages.length + failed,
                total: pages.length + failed + queue.length + 1,
                label: `Page ${slug.replace(PAGE_PREFIX, '') || 'index'}`,
            });
            const info = await evalJsonInTab<{
                ok: boolean;
                length: number;
                links: string[];
                images: string[];
                toc: Array<TableOfContentEntry>;
            }>(tab, `window.__dfq.page(${JSON.stringify(slug)})`).catch(() => ({
                ok: false as const,
            }));
            if (!info.ok) {
                failed++;
                continue;
            }
            const key = slug || ROOT_PAGE;
            const html = DOMPurify.sanitize(
                await pullFromTab(tab, 'page', info.length)
            );
            await writeAll(id, pageFile(key), html);
            pages.push(key);
            if (!slug) toc = info.toc;
            info.links.forEach((link) => {
                if (!seen.has(link)) {
                    seen.add(link);
                    queue.push(link);
                }
            });
            info.images.forEach((src) => imageSrcs.add(src));
        }
        if (!pages.includes(ROOT_PAGE)) {
            throw new Error('Could not load the guide');
        }

        const images: Record<string, string> = {};
        let index = 0;
        for (const src of imageSrcs) {
            checkCancel();
            onProgress({
                done: index,
                total: imageSrcs.size,
                label: `Image ${index + 1} of ${imageSrcs.size}`,
            });
            index++;
            const info = await evalJsonInTab<{ ok: boolean; length: number }>(
                tab,
                `window.__dfq.image(${JSON.stringify(src)})`
            ).catch(() => ({ ok: false, length: 0 }));
            // A missing image does not stop the download; the guide shows the online copy instead
            if (!info.ok) continue;
            const dataUrl = await pullFromTab(tab, 'image', info.length);
            const file = `${index}.${extensionFor(dataUrl)}`;
            await writeAll(id, `images/${file}`, dataUrl);
            images[src] = file;
        }

        forgetOfflineGuide(id);
        return await finishGuide(id, {
            url: rootUrl,
            title: guide.title,
            game: guide.game,
            toc,
            pages,
            images,
            pageCount: pages.length,
            imageCount: Object.keys(images).length,
        });
    } catch (e) {
        await abortGuide(id).catch(() => {});
        throw e;
    } finally {
        browserView.LoadURL('data:text/html,<body><%2Fbody>');
    }
};
