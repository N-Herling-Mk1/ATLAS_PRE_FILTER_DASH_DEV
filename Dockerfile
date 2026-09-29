# ATLAS_PRE_FILTER_DASH -- container image (mk47).
#
#   docker build -t atlas-pfd:dev --build-arg PFD_CODE_COMMIT=$(git rev-parse --short HEAD) .
#
# Two stages: wheels are built in the first, the runtime gets only the wheels
# and the app. Runs as an unprivileged user, live mode, waitress on :5710.
# Data, the store and .env are mounted at run time; none of them is baked in.

FROM python:3.12-slim AS build
WORKDIR /w
COPY requirements.txt .
# pytest is a dev dependency; the runtime image does not carry it
RUN grep -v '^pytest' requirements.txt > req.runtime.txt \
 && pip wheel --no-cache-dir --wheel-dir /wheels -r req.runtime.txt

FROM python:3.12-slim
ARG PFD_CODE_COMMIT=unknown
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PFD_MODE=live PFD_BIND_HOST=0.0.0.0 \
    PFD_STORE_DIR=/store PFD_CODE_COMMIT=${PFD_CODE_COMMIT}
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin pfd
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir --no-index /wheels/* && rm -rf /wheels
WORKDIR /app
COPY --chown=pfd:pfd engine ./engine
COPY --chown=pfd:pfd server ./server
COPY --chown=pfd:pfd catalogue ./catalogue
COPY --chown=pfd:pfd web ./web
COPY --chown=pfd:pfd docs ./docs
RUN mkdir -p /store && chown pfd:pfd /store
USER pfd
EXPOSE 5710
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5710/health', timeout=4).read()==b'ok' else 1)"
CMD ["python", "-m", "server.serve", "--mode", "live", "--no-browser"]
