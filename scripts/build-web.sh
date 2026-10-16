#!/usr/bin/env bash
# Builds the web version into docs/ for GitHub Pages (https://dvirshr.github.io/poker-night).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf docs
EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir docs
python3 - << 'PY'
p = 'docs/index.html'
s = open(p, encoding='utf-8').read()
head = '''
<link rel="manifest" href="/poker-night/manifest.webmanifest">
<meta name="theme-color" content="#111215">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="פוקר">
<link rel="apple-touch-icon" href="/poker-night/apple-touch-icon.png">
<link rel="icon" type="image/png" href="/poker-night/favicon.png">
<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/poker-night/sw.js',{scope:'/poker-night/'})})}</script>
'''
if 'manifest.webmanifest' not in s:
    s = s.replace('</head>', head + '</head>', 1)
s = s.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover')
open(p, 'w', encoding='utf-8').write(s)
PY
cp docs/index.html docs/404.html   # deep links (/group/..., /game/...) on GitHub Pages
touch docs/.nojekyll               # keep _expo/ and node_modules/ asset folders
echo "built docs/ ($(find docs/assets -name '*.ttf' | wc -l) fonts)"
