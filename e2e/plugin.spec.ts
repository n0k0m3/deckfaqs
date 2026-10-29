import { expect, expectToast, GAME, PAGED_GUIDE, SMALL_GUIDE, test } from './steam';

test('shows the main screen', async ({ plugin }) => {
    await expect(plugin.button('Search games')).toBeVisible();
    await expect(plugin.button(/^Offline guides \(\d+\)$/)).toBeVisible();
    await expect(plugin.qam.getByText('Enable Dark Mode?')).toBeVisible();
    await expect(plugin.qam.getByText('Installed Games', { exact: true })).toBeVisible();
});

test('searches GameFAQs by name with the search dialog', async ({ plugin, steam }) => {
    await plugin.button('Search games').click();
    const input = steam.bpm.getByPlaceholder('Search for a game');
    await expect(input).toBeVisible();
    // Only Steam's own dialog form may wrap the input: a form of ours submits natively on Enter
    expect(await input.evaluate((el) => el.closest('form')?.getAttribute('role'))).toBe('dialog');
    await input.fill('Celeste');
    await input.press('Enter');
    await expect(input).toBeHidden();
    await expect(plugin.qam.getByText('Search Results', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(plugin.button('Celeste')).toBeVisible({ timeout: 60_000 });
});

test('opens a guide online with its table of contents and images', async ({ plugin }) => {
    await plugin.openGuideOnline(GAME, PAGED_GUIDE);
    await expect(plugin.qam.getByText('TOC', { exact: true })).toBeVisible();
    await expect(plugin.button(/^(Download for offline use|Update offline copy)$/)).toBeVisible();
    const firstImage = plugin.guideContent.locator('img').first();
    await expect(firstImage).toHaveAttribute('src', /^https:\/\/gamefaqs\.gamespot\.com\//);
});

test('downloads a guide, reads it offline, and deletes it', async ({ plugin, steam }) => {
    await plugin.openGuideOnline(GAME, SMALL_GUIDE);
    await plugin.downloadOpenGuide();
    await expectToast(steam, 'Guide saved for offline use');
    await expect(plugin.button('Update offline copy')).toBeVisible();

    await plugin.button('Home').click();
    await plugin.openOfflineList();
    const row = plugin.savedRow(SMALL_GUIDE);
    await expect(row).toContainText(GAME);
    await expect(row).toContainText(/\d+ pages, \d+ KB/);
    await row.click();
    await expect(plugin.guideContent).toBeVisible();
    // An offline guide cannot be downloaded or reloaded from GameFAQs
    await expect(plugin.button(/offline (use|copy)$/)).toHaveCount(0);
    await expect(plugin.button('Reload guide')).toHaveCount(0);

    await plugin.button('Back').click();
    await row.locator('xpath=..').getByRole('button', { name: 'Delete offline guide' }).click();
    const dialog = steam.bpm.locator('[id^="ModalDialogOverlay"]').filter({ hasText: 'Delete offline guide?' });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeHidden();
});

test('follows a link to another page of an offline guide', async ({ plugin }) => {
    await plugin.ensureSaved(GAME, PAGED_GUIDE);
    await plugin.savedRow(PAGED_GUIDE).click();
    await expect(plugin.guideContent).toBeVisible();
    await plugin.guideContent.locator('a.deckfaqs-link[href="?page=7#Master Quartz"]').first().click();
    const section = plugin.guideContent.locator('[name="Master Quartz"], [id="Master Quartz"]');
    await expect(section).toBeInViewport();
    const images = plugin.guideContent.locator('img');
    expect(await images.count()).toBeGreaterThan(0);
    const remote = await images.evaluateAll((all) =>
        all.map((img) => (img as HTMLImageElement).src).filter((src) => !src.startsWith('data:'))
    );
    expect(remote, 'offline images that load from the network').toEqual([]);
});

test('shows an offline guide in full screen and returns', async ({ plugin, steam }) => {
    await plugin.ensureSaved(GAME, PAGED_GUIDE);
    await plugin.savedRow(PAGED_GUIDE).click();
    await expect(plugin.guideContent).toBeVisible();
    await plugin.button('Full screen').click();
    const back = steam.bpm.getByRole('button', { name: 'Back to DeckFAQs' });
    await expect(back).toBeVisible();
    await expect(steam.bpm.locator('#faqwrap')).toBeVisible();
    await back.click();
    await expect(back).toBeHidden();
    await expect(plugin.guideContent).toBeVisible();
});
