import fs from 'node:fs';
import path from 'node:path';

const guardFlag = 'DAFEIYU_DIRECTORY_LOCKED';
const guardFd = 9;
// Keep the directory descriptor open across exec. The kernel releases the
// lock even on SIGKILL, and Node remains PID 1 to receive Docker stop signals.
const guardCommand = `
  exec 9<"$1"
  if ! /usr/bin/flock --nonblock --exclusive 9; then
    echo '启动失败：已有实例在运行，或无法锁定数据目录' >&2
    exit 1
  fi
  shift
  exec "$@"
`;

function holdDirectoryLock(directory) {
  if (process.env[guardFlag] === '1') {
    delete process.env[guardFlag];
    const descriptor = fs.fstatSync(guardFd);
    const target = fs.statSync(directory);
    if (!descriptor.isDirectory() || descriptor.dev !== target.dev || descriptor.ino !== target.ino) {
      throw new Error('实例数据目录锁验证失败');
    }
    return;
  }
  const argv = ['/bin/sh', '-ec', guardCommand, 'dafeiyu-agent-lock', directory,
    process.execPath, ...process.execArgv, ...process.argv.slice(1)];
  process.execve('/bin/sh', argv, { ...process.env, [guardFlag]: '1' });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

export function acquireAgentLock(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const guarded = process.platform === 'linux' && process.env.DAFEIYU_MANAGED === '1';
  if (guarded) holdDirectoryLock(directory);
  const file = path.join(directory, 'agent.lock');
  if (fs.existsSync(file)) {
    const owner = Number(fs.readFileSync(file, 'utf8'));
    const valid = Number.isSafeInteger(owner) && owner > 0 && owner <= 0x7fffffff;
    // A legacy lock from a live process in this namespace still blocks launch.
    // On a container restart, the current process can reuse the old PID 1.
    const occupied = valid && !(guarded && owner === process.pid) && alive(owner);
    if (occupied || !valid && !guarded) throw new Error('已有实例在运行，请先停止它');
    fs.rmSync(file, { force: true });
  }
  // Managed instances need no PID file once the kernel guard is in place.
  if (guarded) return;
  fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
  process.on('exit', () => {
    try { fs.unlinkSync(file); } catch {}
  });
}
