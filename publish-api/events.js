// SSE 推送中心：每个班级一条流，老师一发布就广播新 revision。
// 选 SSE 而不是 WebSocket：宿主用 HttpClient 收行、浏览器用 EventSource，两边都不用握手库。
const HEARTBEAT_MS = 25 * 1000;

export function createEventHub() {
  const streams = new Map(); // classId -> Set<res>

  function subscribe(classId, res, { hello } = {}) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");
    if (hello) res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);

    if (!streams.has(classId)) streams.set(classId, new Set());
    const bucket = streams.get(classId);
    bucket.add(res);

    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(timer);
      bucket.delete(res);
      if (bucket.size === 0 && streams.get(classId) === bucket) streams.delete(classId);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    return cleanup;
  }

  function publish(classId, payload) {
    const bucket = streams.get(classId);
    if (!bucket) return 0;
    const frame = `event: revision\ndata: ${JSON.stringify(payload)}\n\n`;
    let sent = 0;
    for (const res of bucket) {
      if (res.writableEnded) continue;
      res.write(frame);
      sent += 1;
    }
    return sent;
  }

  function activeCount(classId) {
    return streams.get(classId)?.size ?? 0;
  }

  return { subscribe, publish, activeCount };
}
