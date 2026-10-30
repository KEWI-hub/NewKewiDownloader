First start of Prism
====================
Prism isn't notarized by Apple (that needs a paid developer account), so macOS blocks it
the first time. Allow it once: in Terminal run

    xattr -dr com.apple.quarantine /Applications/Prism.app

or open Prism, then System Settings -> Privacy & Security -> "Open Anyway".

Prism browser extension
=======================

Chrome, Edge, Brave, Opera, Vivaldi, Helium: add it from the Chrome Web Store (it updates by itself):

    https://chromewebstore.google.com/detail/prism-download-manager/mmcdeiglkbfbicdjboocmhehodogilfl

1. Open the link, click "Add to Chrome" (Brave: "Add to Brave"), then "Add extension".
   Edge first asks to allow extensions from other stores: click "Allow".
   Opera first offers its "Install Chrome Extensions" add-on: add it, then come back.
2. Pin the Prism icon (puzzle icon -> pin). It should say "Connected".

Prism walks you through this on first start, and any time in Settings -> Browser
integration. Added Prism by hand before (Developer mode -> Load unpacked)? Remove that copy
on chrome://extensions first: it doesn't update by itself.

Firefox and Zen (Prism isn't in Firefox Add-ons yet)
1. Open about:debugging#/runtime/this-firefox
2. "Load Temporary Add-on..." -> pick manifest.json in the folder Prism shows in
   Settings -> Browser integration (~/Library/Application Support/Prism/extension/firefox).
   Firefox forgets temporary add-ons on restart.
