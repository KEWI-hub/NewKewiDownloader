# Development signing key

`prism-dev.pem` is an RSA-2048 private key generated once with Node's `crypto` **only to give
the unpacked/dev Chromium extension a stable ID**. Its public half (`public-key.txt`, base64
SPKI DER) is embedded as `"key"` in the Chromium manifest by `build.mjs`.

Resulting extension ID: **`mmcdeiglkbfbicdjboocmhehodogilfl`**
(= first 32 hex chars of SHA-256(public key DER), mapped `0-9a-f` → `a-p`).

The native host allows exactly this origin by default
(`prism_native_host::CHROME_EXTENSION_ID`). It is not a secret and is not used for store
publishing (a Web Store / Edge Add-ons listing gets its own ID; pass it to
`prism-native-host register --extension-id-chrome <id>`). The private key is only needed if
you ever want to pack a `.crx` with the same ID.

Recompute the ID:

```
node -e "const c=require('crypto'),d=Buffer.from(require('fs').readFileSync('public-key.txt','utf8'),'base64');console.log([...c.createHash('sha256').update(d).digest('hex').slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join(''))"
```
