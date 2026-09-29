# Deploy — container + tunnel to nth-atlas-llp.com (mk47)

Live path: browser → Cloudflare edge (TLS) → tunnel → `cloudflared` container → `app` container, waitress :5710.

```
        Internet                 this machine (Docker Desktop / Podman)
  ┌──────────────────┐   ┌─────────────────────────────────────────────────┐
  │ Cloudflare edge  │◄──┤ cloudflared  (networks: inner + egress)         │
  │ nth-atlas-llp.com│   │      │ http://app:5710                          │
  └──────────────────┘   │      ▼                                          │
                         │ app  (network: inner, internal — no route out,  │
                         │       no published port; data + locations RO,   │
                         │       store on a named volume, root FS RO)      │
                         └─────────────────────────────────────────────────┘
```

The tunnel dials **out** to Cloudflare, so no router port is opened and the app is never on the LAN.

## Files

| file | what |
|---|---|
| `Dockerfile` | two-stage image, non-root, live mode, healthcheck on `/health` |
| `compose.yaml` | `app` on an internal network; `cloudflared` under the `tunnel` profile |
| `compose.local.yaml` | override: publish `127.0.0.1:5710` for testing, no tunnel |
| `deploy/docker/stack.env.example` | host paths, path map, tunnel token → copy to `stack.env` (git-ignored) |
| `run_docker.ps1` | build + up + health wait, with progress |

## 1. Local, no tunnel

```powershell
python -m server.set_password                       # if there is no .env yet
Copy-Item deploy\docker\stack.env.example deploy\docker\stack.env   # fill in the three paths
.\run_docker.ps1                                    # -> http://127.0.0.1:5710/
```

`PFD_PATH_MAP` rewrites the locations file's Windows paths into the `/data` mount, so the same
locations file serves the host run and the container. `PFD_DATA_HOST` must contain every file the
locations file names. The session cookie is `Secure` in live mode; browsers accept that over
plain `http://127.0.0.1`, so the local run behaves like the hosted one.

The local override puts the app on a normal network as well (Docker cannot publish a port from
an internal-only network), so **in local mode the app has egress**. In tunnel mode it does not.

## 2. Wire the domain (once, in the Cloudflare dashboard)

1. **Zone.** `nth-atlas-llp.com` must be an active zone on the account (it is, if it was bought
   through Cloudflare Registrar).
2. **Tunnel.** Zero Trust → Networks → Tunnels → *Create a tunnel* → **Cloudflared** →
   name it `atlas-pfd`. On the install page choose *Docker* and copy only the token
   (the long string after `--token`) into `TUNNEL_TOKEN` in `stack.env`.
3. **Public hostname.** In the tunnel → *Public Hostname* → *Add*:
   - Subdomain: blank (apex) — or `dash` for `dash.nth-atlas-llp.com`
   - Domain: `nth-atlas-llp.com`
   - Service: **HTTP**, URL **`app:5710`** — the compose service name, not localhost

   Cloudflare creates the proxied CNAME to the tunnel itself.
4. **Optional, recommended:** Zero Trust → Access → Applications → self-hosted app on the same
   hostname, policy *emails = nth@arizona.edu (+ whoever else)*. That puts a one-time-PIN in front
   of the site's own password, at no cost. The site's lock stays as it is either way.

## 3. Up, with the tunnel

```powershell
.\run_docker.ps1 -Tunnel        # app + cloudflared, nothing published on this machine
.\run_docker.ps1 -Logs          # follow both
.\run_docker.ps1 -Down          # stop; the store volume (catalogue, cache, logs) is kept
```

Check: `https://nth-atlas-llp.com/health` returns `ok`; `/` redirects to the sign-in page.

## Before it is public

- Long password: `python -m server.set_password` (5+ random words). The launcher warns if
  `PFD_PASSWORD_WEAK=1` with `-Tunnel`.
- Data governance cleared with Prof. Johns.
- Alerts: SMTP / Twilio need egress, which the app container does not have. Per the egress
  decision they go through a sidecar (not built yet); until then, alerts are console + the
  `events.log` in the store. The external liveness watchdog stays a separate setup.

## Notes

- One process, 16 waitress threads: the job registry is in-process, so never scale `app` past 1.
- The image carries no `.git`; `PFD_CODE_COMMIT` is stamped at build (`run_docker.ps1` does it,
  with `+dirty` when the tree has edits) and shows as `<sha> (image)` in run provenance.
- Podman: `.\run_docker.ps1 -Podman` (needs `podman compose`). Under WSL, set the host paths in
  `stack.env` as `/mnt/c/...`.
- Without containers (the old path): `python -m server.serve --mode live --home` binds
  127.0.0.1:5710, and a host-installed cloudflared uses `service: http://127.0.0.1:5710`.
