# ATLAS-Dashboard-mk_1 — drop mk47: side panel, root2csv, container

First drop on the **dev** line (`ATLAS_PRE_FILTER_DASH_dev`). Restart the server: `pages.py`,
`loader.py`, `serve.py` and `provenance.py` changed.

```
server\pages.py                        + root2csv tile; EXTERNAL holds its URL
web\templates\hub.html                 + side panel (one outline slot per tile)
web\templates\sections\root2csv.html   NEW  pointer sheet: repo link + the three layers
web\templates\sections\_side\eda.html  NEW  EDA outline: 0 Inputs / 1 Hygiene / 2 Exploration
web\templates\sections\_side\root2csv.html NEW
web\static\app\js\hub.js               side panel: show/build outline, jump, sort, ping
web\static\public\css\hub.css          section grid "tv band nav / side stage stage"; outline styles
engine\loader.py                       PFD_PATH_MAP: Windows paths -> container mount
engine\provenance.py                   PFD_CODE_COMMIT when there is no .git (image)
server\serve.py                        --host / PFD_BIND_HOST, live mode only
Dockerfile, .dockerignore              NEW  two-stage image, non-root, healthcheck
compose.yaml, compose.local.yaml       NEW  app on an internal net; cloudflared sidecar (profile tunnel)
deploy\docker\stack.env.example        NEW
deploy\README.md                       rewritten: local run, Cloudflare tunnel + hostname, go-live list
run_docker.ps1, bootstrap_dev_repo.ps1 NEW
tests\test_lock.py                     + hub side panel / root2csv test
tests\test_container.py                NEW  path map + commit stamp (paths only, no data)
```

## Section view

    [ TV ½ = Home ][ section cards ............... ][ nav ]
    [ side panel  ][ the section ........................ ]

The side column is the TV's column. Sections with `sections/_side/<id>.html` get that outline;
the rest get one built from their sheet's *Planned* list, so no section opens with an empty rail.
Below 1100 px the side panel stacks above the section, capped at 190 px.

EDA outline status tags: **sheet** = on this sheet now, **partial**, **gate** = runs as a gate
scan (links to the Verdict board), **planned**.

## Checked here

- Suite: 30 passed, 6 skipped (the real-data tests; no data in the sandbox).
- Browser pass (Chromium, 1680 × 980 and 1024 × 800): landing deck → EDA → outline sort click
  before a run (points at Generate) → root2csv → Features (built outline) → narrow → Esc
  (side panel gone on the landing view). No errors beyond the expected 404s before a first run.
- `docker compose config` resolves for both the local and the tunnel stack.
- Live mode with `--host 0.0.0.0` and `PFD_CODE_COMMIT` starts and answers `/health`.

## Not verified — look at these first

- **The image was not built here**: the sandbox cannot reach Docker Hub. First
  `.\run_docker.ps1` on your machine is the first build.
- The tunnel has not been created; follow `deploy\README.md` §2.
- `cloudflare/cloudflared:2025.8.0` is pinned from memory; if the pull fails, set
  `CLOUDFLARED_TAG` in `stack.env` to a current tag.
- Bind-mounting a OneDrive folder into Docker Desktop works but reads slowly; if the endcap
  run crawls, point `PFD_DATA_HOST` at a copy outside OneDrive.
