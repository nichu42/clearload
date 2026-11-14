import { runAudit } from '../audit.js';
import { runCrawl } from '../crawl.js';

const abortController = new AbortController();
let started = false;

function sendAndExit(payload, exitCode) {
  if (typeof process.send === 'function' && process.connected) {
    process.send(payload, () => process.exit(exitCode));
  } else {
    process.exit(exitCode);
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'abort') {
    abortController.abort();
    return;
  }

  if (msg.type !== 'start' || started) return;
  started = true;

  try {
    if (msg.task === 'audit') {
      const result = await runAudit(msg.targetUrl, msg.options || {});
      sendAndExit({ type: 'result', result }, 0);
      return;
    }

    if (msg.task === 'crawl') {
      const options = { ...(msg.options || {}), signal: abortController.signal };
      const result = await runCrawl(msg.targetUrl, options, (event) => {
        if (typeof process.send === 'function' && process.connected) {
          process.send({ type: 'progress', event });
        }
      });
      sendAndExit({
        type: 'result',
        result: {
          success: Boolean(result?.success),
          category: result?.category,
          error: result?.error
        }
      }, 0);
      return;
    }

    sendAndExit({ type: 'error', error: `Unknown worker task: ${msg.task}` }, 1);
  } catch (error) {
    sendAndExit({ type: 'error', error: error?.message || 'Worker execution failed.' }, 1);
  }
});
