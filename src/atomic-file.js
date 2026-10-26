import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const transient = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
const waitCell = new Int32Array(new SharedArrayBuffer(4));
const waitSync = milliseconds => Atomics.wait(waitCell, 0, 0, milliseconds);

// Store.save must remain synchronous: a pending action must be durable before sending.
export function atomicWriteFile(file, content, { io = fs, wait = waitSync, attempts = 8 } = {}) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let fd;
  let complete = false;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    io.writeFileSync(fd, content);
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    complete = true;
    for (let attempt = 0; ; attempt++) {
      try { io.renameSync(temporary, file); return; }
      catch (error) {
        if (!transient.has(error.code) || attempt + 1 >= attempts) throw error;
        wait(Math.min(250, 15 * 2 ** attempt));
      }
    }
  } catch (error) {
    // Keep a complete new snapshot and the previous canonical file on permanent failure.
    if (complete) error.recoveryFile = temporary;
    throw error;
  } finally {
    if (fd !== undefined) { try { io.closeSync(fd); } catch {} }
    if (!complete) { try { io.unlinkSync(temporary); } catch {} }
  }
}
