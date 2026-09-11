# ATLAS_PRE_FILTER_DASH

Pre-NN feature gate and EDA dashboard for the LLP displaced-vertex search.
Flask, login-locked, real data only. Scope: `docs/STAGE_A_SCOPE_mk2.md` (companions: the August scan-layer, model-selection and row-partition docs, also in `docs/`).

## Run it (Windows, PowerShell)

    Get-ChildItem -Recurse | Unblock-File        # once, after unzipping (PS 5.1)
    .\run_local.ps1 -Data home                   # parity mode: behaves like the hosted site
    .\run_local.ps1 -Data home -Mode dev         # Flask dev server, auto-reload

The launcher builds `C:\venvs\atlas_pfd` on first run and opens the edge_sim URL.
`-Data` takes `home`, `office`, or a path to a locations txt (July format).
`-LlpSrc <folder containing llp\>` makes S9 use the training path's `llp/data.py::apply_scale`;
without it S9 runs labelled reference transforms.

Sign-in is password only. To put a name on your runs, list versions and bundles
(attribution, not a login), set it on the Session page; until then they read "unnamed".
The sign-in page sweeps a detector view in on load. Signing in fires an
illustrative event, drawn in the browser and labelled as not data: "LLP detected"
for the right password, "no LLP detected" (with a rumble) for a wrong one.

## Modes

| mode   | server              | cookie        | client IP from      | use                         |
|--------|---------------------|---------------|---------------------|-----------------------------|
| dev    | Flask dev, reload   | not Secure    | socket              | editing templates/JS        |
| parity | waitress + edge_sim | Secure        | CF-Connecting-IP    | test exactly as hosted      |
| live   | waitress :5710      | Secure        | CF-Connecting-IP    | behind cloudflared (stage D)|

edge_sim stands in for Cloudflare: it adds the CF headers, cuts requests at 100 s (524),
refuses bodies over 100 MB (413) and answers 502 when the app is down. Only TLS differs.

## Password

    python -m server.set_password                # prompt; writes scrypt hash + new SECRET_KEY to .env
    python -m server.set_password --rotate-only  # new SECRET_KEY: signs everyone out

## Headless gate (no server)

    python -m engine.cli --home --check                 # inventory
    python -m engine.cli --home --region all --smoke    # 2,000 rows per file
    python -m engine.cli --home --region endcap         # full

## Tests

    .\run_tests.ps1                 # lock, edge, parity, engine guard
    .\run_tests.ps1 -Data home      # plus the real-data tests

Alerts: failed sign-ins and failed jobs go to console plus any transport enabled in
.env (SMTP, SMS gateway, Twilio; see .env.example). Run page has a test button.

Store (catalogue versions, cache, references, logs) lives in `PFD_STORE_DIR`
(default `C:\pfd_store`), never inside OneDrive.
