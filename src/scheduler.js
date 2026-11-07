export function resumeDelay(lastAt,interval,firstMs,now=Date.now()) {
  if(!Number.isFinite(lastAt)||lastAt<=0||lastAt>now)return firstMs;
  return Math.max(firstMs,Math.max(0,lastAt+interval-now));
}
// Rearm after completion, so slow requests cannot build up overlapping background work.
export function scheduleRecurring(task, interval, { queue, timers, stopped, onError, firstMs = interval, setTimer = setTimeout }) {
  const arm = wait => {
    if (stopped()) return;
    const timer = setTimer(async () => {
      timers.delete(timer);
      if (stopped()) return;
      await queue.add(task).catch(onError);
      arm(interval);
    }, wait);
    timers.add(timer);
  };
  arm(firstMs);
}
