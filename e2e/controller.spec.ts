import { Button, expect, GAME, PAGED_GUIDE, test } from './steam';

// Controller buttons go through Steam's own focus navigation, like Steam Input
test('scrolls a guide and uses its links and spoilers with the controller', async ({ plugin }) => {
    await plugin.ensureSaved(GAME, PAGED_GUIDE);
    await plugin.savedRow(PAGED_GUIDE).click();
    await expect(plugin.guideContent).toBeVisible();
    const scrollTop = () => plugin.guidePanel.evaluate((element) => element.scrollTop);
    // Like a touch scroll or a TOC jump: the view moves, Steam's focus stays where it was
    const scrollToCenter = (text: string) =>
        plugin.guideContent
            .locator('.deckfaqs_item')
            .filter({ hasText: text })
            .first()
            .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const focusIs = (text: string) => async () => (await plugin.focused()).text === text;

    // The D-pad goes from the toolbar into the guide and scrolls it: the first link is far below
    await plugin.pressUntil(Button.DIR_DOWN, async () => (await scrollTop()) > 0);
    expect((await plugin.focused()).inGuide).toBe(true);
    // Up scrolls back to the top, and one more press leaves the guide for the toolbar
    await plugin.pressUntil(Button.DIR_UP, async () => (await scrollTop()) === 0, 30);
    await plugin.pressUntil(Button.DIR_UP, async () => !(await plugin.focused()).inGuide, 2);

    // A link: the D-pad focuses the link in view, and A follows it to another page
    await scrollToCenter('Master Quartz');
    await plugin.pressUntil(Button.DIR_DOWN, focusIs('Master Quartz'), 6);
    await plugin.press(Button.OK);
    await expect(plugin.guideContent.locator('[name="Master Quartz"], [id="Master Quartz"]')).toBeInViewport();

    // Spoilers: A shows one and hides it again, and the D-pad moves on to the next one
    await plugin.chooseTocEntry('Trophy List');
    const alisa = plugin.guideContent.locator('.fspoiler').filter({ hasText: /^Alisa$/ });
    await scrollToCenter('Alisa');
    await plugin.pressUntil(Button.DIR_DOWN, focusIs('Alisa'), 6);
    await expect(alisa).not.toHaveClass(/deckfaqs_revealed/);
    await expect(alisa).toHaveCSS('color', 'rgb(187, 187, 187)');
    await plugin.press(Button.OK);
    await expect(alisa).toHaveClass(/deckfaqs_revealed/);
    await expect(alisa).toHaveCSS('color', 'rgb(13, 13, 13)');
    await plugin.press(Button.OK);
    await expect(alisa).not.toHaveClass(/deckfaqs_revealed/);
    await plugin.pressUntil(Button.DIR_DOWN, async () => (await plugin.focused()).text !== 'Alisa', 2);
    expect((await plugin.focused()).text).toBe('Elliot.');
});
