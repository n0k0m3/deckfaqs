import {
    test as base,
    expect,
    chromium,
    Browser,
    Locator,
    Page,
    TestInfo,
} from '@playwright/test';
import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

// SSH host of the test device, for example an alias in ~/.ssh/config. The global setup requires it.
export const HOST = process.env.DFQ_HOST ?? '';
export const CDP_PORT = Number(process.env.DFQ_CDP_PORT ?? 18080);
export const REMOTE_HELPER = 'deckfaqs-offline-dev/dfq_device.py';
export const PLUGIN = 'DeckFAQs Offline';
export const FULLSCREEN_ROUTE = 'deckfaqs-offline-fullscreen';

const run = promisify(execFile);

// Test data: a public GameFAQs game and two of its guides. The tests find them with the plugin's
// search dialog, so the game does not need to be installed on the device.
export const GAME = 'The Legend of Heroes: Trails of Cold Steel';
export const SMALL_GUIDE = /^Speed\/Delay FAQ/; // one plain-text page
export const PAGED_GUIDE = /^Guide and Walkthrough/; // 11 pages that link with "?page=N", 190+ images

// Steam's GamepadButton values
export enum Button {
    OK = 1,
    DIR_UP = 9,
    DIR_DOWN = 10,
}

export type Steam = {
    browser: Browser;
    shared: Page;
    qam: Page;
    bpm: Page;
    toasts: Page;
};

// Steam's pages keep their titles; a webhelper restart renames them (QuickAccess_uid2 -> _uid15)
async function pageByTitle(browser: Browser, prefix: string): Promise<Page> {
    for (let attempt = 0; attempt < 20; attempt++) {
        for (const context of browser.contexts()) {
            for (const page of context.pages()) {
                if ((await page.title().catch(() => '')).startsWith(prefix)) return page;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Steam has no page titled ${prefix}*. Is the device in Game Mode?`);
}

// Full composited frame from gamescope: game, Steam and Decky together
export async function deviceScreenshot(): Promise<Buffer> {
    const { stdout } = await run(
        'ssh',
        ['-o', 'BatchMode=yes', HOST, `python3 ${REMOTE_HELPER} screenshot`],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }
    );
    return stdout;
}

export async function attachScreenshot(testInfo: TestInfo, name: string) {
    await testInfo.attach(name, {
        body: await deviceScreenshot(),
        contentType: 'image/png',
    });
}

export class PluginPanel {
    constructor(readonly steam: Steam) {}

    get qam() {
        return this.steam.qam;
    }

    button(name: string | RegExp) {
        return this.qam.getByRole('button', {
            name,
            exact: typeof name === 'string',
        });
    }

    get mainScreen() {
        return this.button('Search games');
    }

    async open() {
        await this.steam.shared.evaluate((plugin) => {
            const { Navigation, QuickAccessTab } = (window as any).DFL;
            Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
            (window as any).DeckyPluginLoader.deckyState.setActivePlugin(plugin);
        }, PLUGIN);
        await expect(this.qam.getByText(PLUGIN, { exact: true })).toBeVisible();
    }

    async close() {
        await this.steam.shared.evaluate(() =>
            (window as any).DFL.Navigation.CloseSideMenus()
        );
    }

    // The plugin keeps its screen while the menu is closed (alwaysRender), so tests start from a known state
    async reset() {
        if (this.steam.bpm.url().includes(FULLSCREEN_ROUTE)) {
            await this.steam.shared.evaluate(() =>
                (window as any).DFL.Navigation.NavigateBack()
            );
        }
        await this.open();
        const cancel = this.button('Cancel');
        if (await cancel.isVisible()) {
            await cancel.click();
            await expect(cancel).toBeHidden({ timeout: 60_000 });
        }
        for (let step = 0; step < 5; step++) {
            if (await this.mainScreen.isVisible()) return;
            const home = this.button('Home');
            if (await home.isVisible()) await home.click();
            else await this.button('Back').click();
            await this.qam.waitForTimeout(300);
        }
        await expect(this.mainScreen).toBeVisible();
    }

    async openOfflineList() {
        await this.button(/^Offline guides/).click();
        await expect(this.qam.getByText('Offline Guides', { exact: true })).toBeVisible();
    }

    // Searches GameFAQs through an installed game and opens one of its guides online
    // Searches GameFAQs with the plugin's search dialog and opens one of the game's guides online
    async openGuideOnline(game: string, guide: RegExp) {
        await this.button('Search games').click();
        const input = this.steam.bpm.getByPlaceholder('Search for a game');
        await input.fill(game);
        await input.press('Enter');
        await expect(input).toBeHidden();
        await expect(this.qam.getByText('Search Results', { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await this.button(game).first().click();
        await expect(this.qam.getByText('Guides', { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await this.button(guide).click();
        await expect(this.guideContent).toBeVisible({ timeout: 60_000 });
    }

    get guideContent() {
        return this.qam.locator('#faqwrap');
    }

    get guidePanel() {
        return this.qam.locator('.deckfaqs_scrollpanel');
    }

    // Opens a page of the open guide through the TOC dropdown. Steam shows the list in the Big Picture window.
    // The click there moves input to that window, and real taps then miss the menu. A click on the
    // plugin title moves input back; the menu window then slides in again (see calibrateWhenStill).
    async chooseTocEntry(label: string) {
        await this.qam.locator('.DialogDropDown_CurrentDisplay').click();
        await this.steam.bpm.locator('.contextMenuItem').filter({ hasText: label }).first().click();
        await expect(this.qam.locator('.DialogDropDown_CurrentDisplay')).toHaveText(label);
        await this.qam.getByText(PLUGIN, { exact: true }).click();
    }

    // A controller button through Steam's focus navigation, the path that Steam Input uses.
    // With no recent user input, Steam has no active navigation context and drops the button,
    // so this first runs Steam's own fallback to the last active context.
    async press(button: Button) {
        await this.steam.shared.evaluate((b) => {
            const nav = (window as any).FocusNavController;
            nav.FindAnActiveContext();
            nav.DispatchVirtualButtonClick(b);
        }, button);
        await this.qam.waitForTimeout(400);
    }

    async pressUntil(button: Button, done: () => Promise<boolean>, times = 15) {
        for (let count = 0; count < times; count++) {
            await this.press(button);
            if (await done()) return;
        }
        throw new Error(`pressed ${Button[button]} ${times} times without the expected result`);
    }

    // The element that has Steam's focus. Steam sends the A button there, not to document.activeElement.
    async focused(): Promise<{ text: string; inGuide: boolean }> {
        return this.steam.shared.evaluate(() => {
            const nav = (window as any).FocusNavController;
            const context = nav.GetActiveContext() ?? nav.m_LastActiveContext;
            const element = context?.m_LastActiveNavTree?.GetLastFocusedNode?.()?.Element;
            return {
                text: element?.textContent?.trim() ?? '',
                inGuide: !!element?.closest('.deckfaqs_scrollpanel'),
            };
        });
    }

    // A saved row's name starts with the game, so the guide pattern must not be anchored
    savedRow(guide: RegExp): Locator {
        return this.button(new RegExp(guide.source.replace(/^\^/, '')));
    }

    // Leaves the panel on the offline list with the guide in it, downloading the guide first if needed
    async ensureSaved(game: string, guide: RegExp) {
        await this.openOfflineList();
        if (await this.savedRow(guide).isVisible()) return;
        await this.button('Back').click();
        await this.openGuideOnline(game, guide);
        await this.downloadOpenGuide();
        await this.button('Home').click();
        await this.openOfflineList();
        await expect(this.savedRow(guide)).toBeVisible();
    }

    // Starts a download of the open online guide and waits for the progress panel to finish
    async downloadOpenGuide() {
        await this.qam
            .getByRole('button', { name: /^(Download for offline use|Update offline copy)$/ })
            .click();
        const progress = this.qam.getByText(/^Saving /);
        await expect(progress).toBeVisible();
        await expect(progress).toBeHidden({ timeout: 300_000 });
    }
}

export async function expectToast(steam: Steam, text: string) {
    await expect
        .poll(
            async () => {
                for (const page of [steam.toasts, steam.bpm, steam.qam]) {
                    if (await page.getByText(text).count()) return true;
                }
                return false;
            },
            { timeout: 15_000, message: `toast "${text}"` }
        )
        .toBe(true);
}

type TapTarget = { x: number; y: number };

// A virtual touchscreen on the device. Taps go through gamescope like a finger.
export class Touchscreen {
    private origin?: TapTarget;
    private dpr = 1;

    private constructor(
        private readonly process: ChildProcessWithoutNullStreams,
        private readonly lines: AsyncIterator<string>,
        readonly screen: { width: number; height: number }
    ) {}

    static async start(): Promise<Touchscreen> {
        const child = spawn('ssh', ['-o', 'BatchMode=yes', HOST, `python3 -u ${REMOTE_HELPER} touch`]);
        child.stderr.on('data', (data) => process.stderr.write(`[touch helper] ${data}`));
        const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
        const first = String((await lines.next()).value);
        const [ready, width, height] = first.split(' ');
        if (ready !== 'ready') throw new Error(`touch helper did not start: ${first}`);
        return new Touchscreen(child, lines, { width: Number(width), height: Number(height) });
    }

    private async send(command: string) {
        this.process.stdin.write(`${command}\n`);
        const answer = await this.lines.next();
        if (answer.value !== 'ok') throw new Error(`touch helper: ${answer.value}`);
    }

    async tapScreen(x: number, y: number) {
        await this.send(`tap ${Math.round(x)} ${Math.round(y)}`);
    }

    async swipeScreen(from: TapTarget, to: TapTarget, ms = 300) {
        await this.send(
            `swipe ${Math.round(from.x)} ${Math.round(from.y)} ${Math.round(to.x)} ${Math.round(to.y)} ${ms}`
        );
    }

    // Records where pointer events land in the page, so each tap can be checked
    static async recordPointer(page: Page) {
        await page.evaluate(() => {
            const w = window as any;
            w.__dfqPointer = [];
            // Replace a recorder left by an earlier run, which may be an older version
            if (w.__dfqPointerListener) w.removeEventListener('pointerdown', w.__dfqPointerListener, true);
            w.__dfqPointerListener = (event: PointerEvent) =>
                w.__dfqPointer.push({
                    x: event.clientX,
                    y: event.clientY,
                    type: event.pointerType,
                    // Checked now: the tap can remove the target
                    onTarget: !!(event.target as Element).closest?.('[data-dfq-tap-target]'),
                });
            w.addEventListener('pointerdown', w.__dfqPointerListener, true);
        });
    }

    static async lastPointer(page: Page): Promise<{ x: number; y: number; type: string; onTarget: boolean }> {
        return page.evaluate(() => (window as any).__dfqPointer.at(-1));
    }

    // Steam reports screenX 0 for the menu window, so its screen origin is measured with one tap.
    // A transparent overlay catches that tap, so it cannot press anything.
    // at: a point as fractions of the screen that the page covers
    async calibrate(page: Page, at = { x: 0.85, y: 0.5 }) {
        await Touchscreen.recordPointer(page);
        this.dpr = await page.evaluate(() => {
            const overlay = document.createElement('div');
            overlay.id = 'dfq-calibration';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
            for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend']) {
                overlay.addEventListener(type, (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
            }
            document.body.appendChild(overlay);
            return window.devicePixelRatio;
        });
        try {
            // The default point is inside the quick access panel on every Steam handheld layout
            const screen = { x: this.screen.width * at.x, y: this.screen.height * at.y };
            await this.tapScreen(screen.x, screen.y);
            await expect
                .poll(() => page.evaluate(() => (window as any).__dfqPointer.length))
                .toBeGreaterThan(0);
            const hit = await Touchscreen.lastPointer(page);
            expect(hit.type).toBe('touch');
            this.origin = { x: screen.x - hit.x * this.dpr, y: screen.y - hit.y * this.dpr };
            return this.origin;
        } finally {
            await page.evaluate(() => document.getElementById('dfq-calibration')?.remove());
        }
    }

    // The menu window slides back in after input returns to it from another window. This waits
    // until two calibration taps in a row find the window at the same place.
    async calibrateWhenStill(page: Page) {
        let last = await this.calibrate(page);
        for (let attempt = 0; attempt < 10; attempt++) {
            await page.waitForTimeout(200);
            const now = await this.calibrate(page);
            if (Math.abs(now.x - last.x) < 1 && Math.abs(now.y - last.y) < 1) return now;
            last = now;
        }
        throw new Error(`${page.url()} did not stop moving`);
    }

    // Taps the center of an element and checks that a touch pointer landed on it
    async tap(page: Page, target: Locator) {
        if (!this.origin) throw new Error('calibrate() first');
        await expect(target).toBeVisible();
        // Like a user, bring the control out from under the menu's title bar first
        await target.evaluate((element) => {
            element.scrollIntoView({ block: 'center' });
            element.setAttribute('data-dfq-tap-target', '');
        });
        const box = (await target.boundingBox())!;
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.evaluate(() => ((window as any).__dfqPointer = []));
        await this.tapScreen(this.origin.x + center.x * this.dpr, this.origin.y + center.y * this.dpr);
        await expect.poll(async () => (await page.evaluate(() => (window as any).__dfqPointer.length))).toBeGreaterThan(0);
        const hit = await Touchscreen.lastPointer(page);
        expect(hit.type).toBe('touch');
        const where = `tap aimed at ${Math.round(center.x)},${Math.round(center.y)}, landed at ${Math.round(hit.x)},${Math.round(hit.y)}`;
        expect(Math.abs(hit.x - center.x), where).toBeLessThanOrEqual(8);
        expect(Math.abs(hit.y - center.y), where).toBeLessThanOrEqual(8);
        expect(hit.onTarget, 'the tap reached the target, not something on top of it').toBe(true);
        await page.evaluate(() =>
            document.querySelectorAll('[data-dfq-tap-target]').forEach((e) => e.removeAttribute('data-dfq-tap-target'))
        );
    }

    async swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
        if (!this.origin) throw new Error('calibrate() first');
        const screen = (p: TapTarget) => ({ x: this.origin!.x + p.x * this.dpr, y: this.origin!.y + p.y * this.dpr });
        await this.swipeScreen(screen(from), screen(to), 400);
    }

    async stop() {
        this.process.stdin.write('quit\n');
        this.process.stdin.end();
        await new Promise((resolve) => this.process.once('exit', resolve));
    }
}

async function answers(page: Page, ms: number): Promise<boolean> {
    return Promise.race([
        page.evaluate(() => true).catch(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
}

export const test = base.extend<{ plugin: PluginPanel; guard: void }, { steam: Steam }>({
    steam: [
        async ({}, use) => {
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
            const steam: Steam = {
                browser,
                shared: await pageByTitle(browser, 'SharedJSContext'),
                qam: await pageByTitle(browser, 'QuickAccess'),
                bpm: await pageByTitle(browser, 'Steam Big Picture'),
                toasts: await pageByTitle(browser, 'notificationtoasts'),
            };
            await use(steam);
            // No browser.close(): this is the user's Steam client. The worker exit drops the CDP connection.
        },
        { scope: 'worker' },
    ],

    guard: [
        async ({ steam }, use, testInfo) => {
            const running = await steam.shared.evaluate(() =>
                ((window as any).SteamUIStore?.RunningApps ?? []).map((app: any) => app.display_name)
            );
            if (running.length) throw new Error(`a game is running (${running.join(', ')}); the tests tap the screen`);
            // A form submit that nobody cancels navigates the Big Picture window away from Steam's UI
            await steam.bpm.evaluate(() => {
                const w = window as any;
                w.__dfqUnhandledSubmits = [];
                if (w.__dfqSubmitNet) return;
                w.__dfqSubmitNet = true;
                w.addEventListener('submit', (event: Event) => {
                    if (event.defaultPrevented) return;
                    event.preventDefault();
                    w.__dfqUnhandledSubmits.push(String((event.target as Element)?.outerHTML).slice(0, 120));
                });
            });
            await use();
            if (testInfo.status !== testInfo.expectedStatus) {
                await attachScreenshot(testInfo, 'device-on-failure').catch(() => {});
            }
            expect(await answers(steam.shared, 10_000), "Steam's UI thread answers").toBe(true);
            expect(steam.bpm.url(), 'Big Picture window left Steam UI').toContain('steamloopback.host');
            expect(
                await steam.bpm.evaluate(() => (window as any).__dfqUnhandledSubmits),
                'form submits that would have navigated Steam'
            ).toEqual([]);
        },
        { auto: true },
    ],

    plugin: async ({ steam }, use) => {
        const panel = new PluginPanel(steam);
        await panel.reset();
        await use(panel);
    },
});

export { expect };
