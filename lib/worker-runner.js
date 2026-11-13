import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'scan-worker.js');

const activeWorkers = new Set();

function buildWorkerEnv() {
  const env = { ...process.env };
  // Allow the scan/crawl worker to use Node's default libuv threadpool size
  // even when the idle HTTP server restricts UV_THREADPOOL_SIZE=1.
  delete env.UV_THREADPOOL_SIZE;
  return env;
}

function runInWorker(task, targetUrl, options = {}, progressCallback = null) {
  const { signal, ...serializableOptions } = options;

  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      execArgv: [],
      env: buildWorkerEnv(),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    activeWorkers.add(child);

    let settled = false;
    let killTimer = null;

    const cleanup = () => {
      activeWorkers.delete(child);
      if (killTimer) clearTimeout(killTimer);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (child.connected) {
        try {
          child.send({ type: 'abort' });
        } catch {
          // Ignore IPC send failure if child already closed
        }
      }
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 6000);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress' && progressCallback) {
        progressCallback(msg.event);
      } else if (msg.type === 'result' && !settled) {
        settled = true;
        cleanup();
        resolve(msg.result);
      } else if (msg.type === 'error' && !settled) {
        settled = true;
        cleanup();
        reject(new Error(msg.error || 'Scan worker failed.'));
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    child.on('exit', (code, exitSignal) => {
      if (!settled) {
        settled = true;
        cleanup();
        const reason = exitSignal ? `signal ${exitSignal}` : `exit code ${code}`;
        reject(new Error(`Scan worker terminated unexpectedly (${reason}).`));
      }
    });

    child.send({ type: 'start', task, targetUrl, options: serializableOptions });
  });
}

/**
 * Run a single-page audit in an isolated child process so Playwright and
 * Chromium memory is returned to the OS as soon as the scan completes.
 */
export function runAuditInWorker(targetUrl, options = {}) {
  return runInWorker('audit', targetUrl, options);
}

/**
 * Run a multi-page site crawl in an isolated child process, streaming
 * progress events back over IPC.
 */
export function runCrawlInWorker(targetUrl, options = {}, progressCallback = null) {
  return runInWorker('crawl', targetUrl, options, progressCallback);
}

/**
 * Terminate any active worker processes on server shutdown.
 */
export function shutdownWorkers() {
  for (const child of activeWorkers) {
    try {
      if (child.connected) {
        child.send({ type: 'abort' });
      }
      child.kill('SIGTERM');
    } catch {
      // Ignore shutdown errors
    }
  }
}
