# DeckFAQs Offline

A fork of [DeckFAQs](https://github.com/hulkrelax/deckfaqs) by hulkrelax. This fork can save GameFAQs guides to the Steam Deck, so you can read them without a network connection.

## Controls

| Input | Action |
|---|---|
| D-pad down or up | Scroll the guide. When a link or a spoiler is in view, the D-pad stops on it first. |
| A | Follow the selected link, or show or hide the selected spoiler. |
| Touch drag | Scroll the guide. |
| Tap | Follow a link, or show or hide a spoiler. |

Spoilers show as gray boxes until you show them.

## Offline Guides

1. Open a guide.
2. Push the download button (arrow icon) in the guide toolbar.
3. Wait for the progress bar to finish. The plugin saves every page of the guide and its images.
4. To read a saved guide, push **Offline guides** on the main screen and select the guide.

The download button shows a check mark when the guide is already saved. Push it again to update the saved copy. To delete a saved guide, push the trash button next to it in the **Offline guides** list.

The plugin stores guides in `~/homebrew/data/DeckFAQs Offline/guides/`.

### Requirements

Decky Loader 3 or later. The plugin uses `@decky/ui` and `@decky/api` (`api_version` 1). The upstream DeckFAQs 1.8.0 uses `decky-frontend-lib` 3.21.8, which fails to load on current Steam clients.

### How it works

GameFAQs blocks requests that do not come from a browser. The plugin loads the guide in a hidden Steam browser view and runs same-origin `fetch()` calls in that page. It reads each page and image in chunks of 256K characters, because Decky limits each websocket message to 4 MB. The download follows both page styles that GameFAQs uses: path links (`limgrave`) and query links (`?page=7`). The Python backend (`main.py`) writes the files.

### Build

1. Run `npx pnpm@9 install`.
2. Run `./scripts/package.sh`.
3. Copy `out/deckfaqs-offline.zip` to the Deck, or serve it over HTTP.
4. In Decky, open **Settings > Developer** and install the zip with **Install Plugin from ZIP** or **Install Plugin from URL**.

## End-to-end tests

The tests in `e2e/` drive the installed plugin on a real handheld in Game Mode. They use Playwright over Steam's DevTools port, and a virtual touchscreen for real taps.

### Requirements

- SSH access to the device without a password prompt. Set `DFQ_HOST` to its host name or SSH alias.
- Decky Loader with this plugin installed.
- On the device: `python-evdev`, `xprop`, and write access to `/dev/uinput` for the Game Mode user.
- No game running. The tests tap the screen, and they stop if a game runs.
- A network connection on the device. The tests search GameFAQs for *The Legend of Heroes: Trails of Cold Steel* and use two of its guides (`GAME`, `SMALL_GUIDE` and `PAGED_GUIDE` in `e2e/steam.ts`). The game does not need to be installed.
- A handheld whose internal panel is natively landscape. The touch helper reads the screen size from the panel's DRM mode, and it does not rotate coordinates for a portrait panel such as the Steam Deck's.

### Run

1. Install the current build on the device.
2. Run `DFQ_HOST=<ssh host> PLAYWRIGHT_HTML_OPEN=never npx playwright test`.
3. Open `playwright-report/index.html` for the results. The touch test attaches full-frame device screenshots.

### How it works

- `e2e/global-setup.ts` copies `e2e/device/dfq_device.py` to the device and opens an SSH tunnel to Steam's DevTools port (8080).
- The tests attach with `connectOverCDP` and never close Steam's pages or browser.
- `e2e/device/dfq_device.py` takes gamescope's full composited frame and runs a virtual touchscreen through `/dev/uinput`.
- The touch test measures the screen origin of the Quick Access window with one tap on a transparent overlay. Each tap must land within 8 CSS pixels of its target, on the target itself.
- The controller test sends buttons through Steam's focus navigation (`FocusNavController.DispatchVirtualButtonClick`), the same path that Steam Input uses. It checks the node that Steam treats as focused, because Steam sends the A button there.

### Safety measures

These come from real failures on the test device:

- Steam started its screensaver during runs (on AC power after 5 minutes without input; CDP input and virtual touch do not count as input). Twice, with Playwright attached, the new screensaver window froze Steam's UI thread. The setup now sets both screensaver timeouts to 0 and saves your values in `e2e/.screensaver-backup.json`. The teardown restores them and deletes the file. If a run crashes, the next run keeps the saved values.
- A native form submit in the Big Picture window navigates it away from Steam's UI. A listener cancels any submit that the app does not handle, and the test fails.
- After each test, the suite checks that Steam's UI thread still answers. The run stops at the first failure (`maxFailures: 1`).

# DeckFAQs

## Description

A GameFAQs browser for the Steam Deck. This plugin supports both Steam and non-Steam games (like things setup with Steam Rom Manager for example)

Built with [Decky Loader](https://github.com/SteamDeckHomebrew/PluginLoader).

## How to Install

### Current Version (Decky Loader version)

1. You need to install the [Decky Loader pre-release](https://github.com/SteamDeckHomebrew/PluginLoader#installation) first before getting started.
2. Download/Install Steps
    - Install from Decky Loader directly. DeckFAQs is on the Decky Loader store browser. Be sure to download DeckFAQs and not "deckfaqs_plugin_browser" which is legacy and no longer supported

## Features

DeckFAQs supports both rich-text and plain-text guides from GameFAQs.

### Game List

![](images/001_games.jpeg)

### Search Results

![](images/002_results.png)

### Guides

![](images/003_guides.png)

### Rich-text Guide

![](images/rich_text.jpg)

### Plain-text Guide

![](images/005_plain.png)

### Fullscreen Guide

![](images/006_fullscreen.png)

![](images/fullscreen.jpg)

### Dark Mode

![](images/dark_mode.jpg)

### Search

![](images/search.jpg)

## Known Issues

-   It is possible that some non-game games (thins like Chrome) will show up in your list of games. I have a filter to remove some obvious non-games but the list is non-exhaustive. We can always expand the filter to remove them over time. In any case, it doesn't really break anything as far as I know and hopefully you have more games than non-games :smile:

Report issues or feature requests [here](https://github.com/hulkrelax/deckfaqs/issues).
