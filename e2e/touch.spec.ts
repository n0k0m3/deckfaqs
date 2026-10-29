import { attachScreenshot, expect, GAME, PAGED_GUIDE, test, Touchscreen } from './steam';

// Real input: a virtual touchscreen on the device, through gamescope and Steam, like a finger
test('real taps and a swipe reach the plugin', async ({ plugin }, testInfo) => {
    await plugin.ensureSaved(GAME, PAGED_GUIDE);
    await plugin.button('Back').click();
    await expect(plugin.mainScreen).toBeVisible();

    const qam = plugin.qam;
    const touch = await Touchscreen.start();
    try {
        await touch.calibrate(qam);
        await attachScreenshot(testInfo, '1-main-screen');

        await touch.tap(qam, plugin.button(/^Offline guides/));
        await expect(qam.getByText('Offline Guides', { exact: true })).toBeVisible();
        await attachScreenshot(testInfo, '2-offline-list');

        await touch.tap(qam, plugin.savedRow(PAGED_GUIDE));
        await expect(plugin.guideContent).toBeVisible();
        await attachScreenshot(testInfo, '3-offline-guide');

        // Swipe up inside the guide's scroll panel: the guide must scroll by about the drag distance.
        // The panel ends above the bottom of the menu window, so the swipe uses the panel's own box.
        const panel = qam.locator('.deckfaqs_scrollpanel');
        const box = (await panel.boundingBox())!;
        const x = box.x + box.width / 2;
        const from = box.y + box.height * 0.85;
        const to = box.y + box.height * 0.15;
        const scrollTop = () => panel.evaluate((element) => element.scrollTop);
        const before = await scrollTop();
        await touch.swipe(qam, { x, y: from }, { x, y: to });
        await expect.poll(scrollTop).toBeGreaterThan(before + (from - to) * 0.5);
        expect(await scrollTop(), 'one drag scrolls once, not twice').toBeLessThan(before + (from - to) * 1.5);
        await attachScreenshot(testInfo, '4-after-swipe');

        await plugin.chooseTocEntry('Trophy List');
        await touch.calibrateWhenStill(qam);

        // A tap on a spoiler shows it, and a second tap hides it again
        const spoiler = plugin.guideContent.locator('.fspoiler').filter({ hasText: /^Alisa$/ });
        await touch.tap(qam, spoiler);
        await expect(spoiler).toHaveClass(/deckfaqs_revealed/);
        await attachScreenshot(testInfo, '5-spoiler-shown');
        await touch.tap(qam, spoiler);
        await expect(spoiler).not.toHaveClass(/deckfaqs_revealed/);

        await touch.tap(qam, plugin.button('Back'));
        await expect(qam.getByText('Offline Guides', { exact: true })).toBeVisible();
        await touch.tap(qam, plugin.button('Back'));
        await expect(plugin.mainScreen).toBeVisible();
        await attachScreenshot(testInfo, '6-back-to-main');
    } finally {
        await touch.stop();
    }
});
