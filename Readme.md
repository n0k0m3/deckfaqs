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
