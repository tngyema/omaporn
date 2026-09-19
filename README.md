# Omaporn

Age-gated combined Eporner and AdultColony search with an embedded player
for the Omarchy shell.

Panel plus bar button plugin (`kinds: ["panel", "bar-widget"]`). Click the
`18+` bar button or summon it, confirm 18+, search, and open a result in a detached embedded
viewer (`qml6` + `QtWebEngine`).

## Install

```sh
omarchy plugin add https://github.com/tngyema/omaporn --enable --yes
omarchy restart shell
```

The install command only clones and validates the repository; it does not run
an installer or request elevated privileges. Review this unsandboxed plugin
before enabling it.

## Uninstall

```sh
omarchy plugin remove io.github.tngyema.omaporn --yes
omarchy restart shell
```

This removes the plugin checkout and its configured bar entry. It does not
remove Docker images or containers created separately for AdultColony.

## Summon

```bash
omarchy-shell shell summon io.github.tngyema.omaporn '{"query":"all"}'
omarchy-shell shell hide io.github.tngyema.omaporn
omarchy-shell shell toggle io.github.tngyema.omaporn '{"query":"amateur"}'
omarchy-shell shell summon io.github.tngyema.omaporn '{"source":"colony","site":"pornhub","query":"all"}'
omarchy-shell shell summon io.github.tngyema.omaporn '{"source":"both","site":"xvideos","query":"all"}'
```

Blocked search terms fall back to `"all"` on summon and are rejected in
the search field with `Search terms must describe adults only`.

## Sources

- **Eporner** (default) — official Eporner JSON API, full pagination and
  result ordering, embedded `/embed/` player. The order button includes
  most viewed today, this week, this month, and all time, plus latest and
  other sort modes. Ordinary searches request
  straight-only, high-quality results; the Gay category uses Eporner's strict
  Gay filter.
- **Colony** — a self-hosted AdultColony-API instance
  (https://github.com/Snowball-01/AdultColony-API) with the repository's
  13 adapters: Eporner, Pornhub, xHamster, SpankBang, XNXX, XVideos,
  HentaiFox, HentaiCity, XAsiat, JavHD.today, JavTsunami, JavGiga, and
  MissAV. There is no usable public instance, so run it locally first:

  ```bash
  docker run --rm --name adultcolony-api -p 127.0.0.1:3000:3000 snowball60/adultcolony-api:latest
  ```

  Then switch the panel to Colony, pick a site chip, and set the base URL
  (default `http://127.0.0.1:3000`). Colony search responses carry no
  totals, so pagination is open-ended (`Page N`, Next while results keep
  coming). Pornhub results use the canonical `pornhub.com` domain. Colony
  results open the site watch page in the viewer instead of an embed URL.

- **Both** — fires Eporner and Colony (selected site) in parallel and merges
  both feeds into one grid, Eporner rows first, duplicates removed by URL.
  Each row is badged with its source (`Eporner`, `Pornhub`, …). If one API
  fails you still get the other half plus a `Partial results (…)` notice.

## How it works

- `Panel.qml` — age gate, search field, category chips, result grid,
  pagination, and viewer lifecycle. Follows the first-party standalone
  panel contract (`open(payloadJson)` / `close()` / `dismiss()` via
  `shell.hide`, `opened` property, `PanelWindow` + scrim + `Esc`).
- `EpornerApi.js` — official-API search-URL builder and response
  normalizer. Only `https://*.eporner.com/embed/<id>/` URLs and
  eporner-hosted thumbnails/storyboards survive normalization; results
  matching the blocked-content list are dropped; blocked queries throw before
  any request. Requests time out after 10 seconds.
- `ColonyApi.js` — self-hosted AdultColony client (search/get URL builders,
  per-site domain allowlist, count/rating/duration parsing). Only https
  watch-page links on the selected site domain survive normalization.
- `ViewerWindow.qml` — standalone `qml6` window that receives the
  approved URL and source label as command-line arguments.
- `ViewerContent.qml` — off-the-record `WebEngineView` (memory cache, no
  persistent cookies, downloads cancelled, fullscreen restricted to approved
  provider origins, all feature permissions denied, page scripts cannot close
  the host window). The shell process never hosts web content itself.
- Opening a video hides the panel (`opened = false`) while the static viewer
  is detached; when the viewer exits the panel returns. Re-summoning while a
  viewer runs stops the old viewer first. Eporner storyboard thumbnails are
  scrubbed by moving across a result card's thumbnail.

## Requirements

- `qml6` on `PATH`
- QtWebEngine QML module (`QtWebEngine`; on Arch this is provided by `qt6-webengine`)
- Network access to `www.eporner.com` (API), provider CDNs, and the local
  AdultColony server when Colony or Both is selected

AdultColony is optional. Its Docker image and the scraper requests it makes
are external dependencies; this plugin does not install Docker, start the
container, or access the Docker socket. The example binds the API to loopback
only. Running Docker may require membership in the local `docker` group or
the user's normal Docker authorization, depending on the host configuration.

## Tests

```bash
omarchy plugin validate .
node --test EpornerApi.test.cjs ColonyApi.test.cjs ViewerWindow.test.cjs
qmllint -I "$OMARCHY_PATH/shell" BarWidget.qml Panel.qml ViewerWindow.qml ViewerContent.qml
```

## Layout

```text
manifest.json        schemaVersion 1, kinds ["panel", "bar-widget"], entryPoints.panel + entryPoints.barWidget
Panel.qml            age gate + combined search + previews + viewer lifecycle
BarWidget.qml        18+ bar button that toggles the panel
EpornerApi.js        official API client (also require()'d by the tests)
EpornerApi.test.cjs  node:test suite
ColonyApi.js         AdultColony client (also require()'d by the tests)
ColonyApi.test.cjs   node:test suite
ViewerWindow.qml     static detached viewer entry point
ViewerWindow.test.cjs QML startup smoke test
ViewerContent.qml    embedded web player content
README.md            this file
LICENSE              MIT
```
