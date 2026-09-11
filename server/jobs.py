"""Background job queue (scope §3). Anything that can exceed ~5 s runs here and
the page polls /api/jobs/<id> -- mandatory because Cloudflare cuts a request at
100 s. Jobs belong to a session id; one session never sees another's jobs.

Single-process design: when this moves to gunicorn it must run ONE worker with
threads, or the in-memory registry splits.
"""
import itertools
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

_ids = itertools.count(1)


class Job:
    def __init__(self, sid, kind, label, who=None):
        self.id = f"j{next(_ids):05d}"
        self.sid, self.kind, self.label, self.who = sid, kind, label, who
        self.status, self.progress, self.msg = "queued", 0.0, "queued"
        self.created, self.started, self.finished = time.time(), None, None
        self.error, self.result = None, None

    def public(self, position=None):
        return {"id": self.id, "kind": self.kind, "label": self.label, "status": self.status,
                "progress": round(self.progress, 4), "msg": self.msg, "error": self.error,
                "queue_position": position,
                "elapsed_s": round((self.finished or time.time()) - (self.started or time.time()), 1)
                if self.started else 0.0}


class JobQueue:
    def __init__(self, workers, on_error=None):
        self.on_error = on_error
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="pfd-job")
        self.workers = workers
        self.jobs = {}
        self.lock = threading.Lock()

    def submit(self, sid, kind, label, fn, on_done=None, who=None):
        job = Job(sid, kind, label, who)
        with self.lock:
            self.jobs[job.id] = job

        def progress(frac, msg):
            job.progress, job.msg = max(0.0, min(1.0, frac)), msg

        def body():
            job.status, job.started, job.msg = "running", time.time(), "starting"
            try:
                job.result = fn(progress)
                if on_done:
                    on_done(job.result)
                job.status, job.progress, job.msg = "done", 1.0, "done"
            except Exception as e:           # reported to the page, traceback to console
                traceback.print_exc()
                job.status, job.error = "error", f"{type(e).__name__}: {e}"
                job.msg = "failed"
                if self.on_error:
                    try:
                        self.on_error(job)
                    except Exception:
                        traceback.print_exc()
            finally:
                job.finished = time.time()

        self.pool.submit(body)
        return job

    def get(self, sid, jid):
        j = self.jobs.get(jid)
        if j is None or j.sid != sid:
            return None
        return j.public(self._position(j))

    def for_session(self, sid):
        return [j.public(self._position(j)) for j in self.jobs.values() if j.sid == sid]

    def _position(self, job):
        if job.status != "queued":
            return None
        ahead = [j for j in self.jobs.values() if j.status == "queued" and j.created < job.created]
        return len(ahead) + 1

    def running_for(self, sid, kind):
        return [j for j in self.jobs.values()
                if j.sid == sid and j.kind == kind and j.status in ("queued", "running")]
