#!/bin/sh
# Builds the frontend and writes a Decky plugin zip to out/
set -e
cd "$(dirname "$0")/.."
NAME="DeckFAQs Offline"
npx pnpm@9 build
rm -rf out && mkdir -p "out/$NAME/dist"
cp plugin.json package.json main.py LICENSE "out/$NAME/"
cp dist/index.js dist/index.js.map "out/$NAME/dist/"
(cd out && python3 -m zipfile -c deckfaqs-offline.zip "$NAME")
echo "Wrote out/deckfaqs-offline.zip"
