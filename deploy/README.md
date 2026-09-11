# Stage D (not built in mk1)

Live path: browser -> Cloudflare edge -> tunnel -> cloudflared on this box -> waitress @ 127.0.0.1:5710.

    python -m server.serve --mode live --home      # waitress on 127.0.0.1:5710, Secure cookies, trusts CF-Connecting-IP

cloudflared ingress, when the tunnel is created:

    ingress:
      - hostname: nth-atlas-llp.com
        service: http://127.0.0.1:5710
      - service: http_status:404

Before going live: change the password (`python -m server.set_password`, 5+ random words),
confirm the domain is in the Cloudflare zone, and clear data governance with Prof. Johns.
Under gunicorn (WSL) run ONE worker with threads: the job registry is in-process.
