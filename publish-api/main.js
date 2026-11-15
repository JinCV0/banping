// 进程入口：起服务、打一行地址、安静地等请求。
import { createServer } from "./server.js";

const app = createServer();
const address = await app.listen();
const shown = typeof address === "object" && address ? `${app.config.host}:${address.port}` : app.config.host;
console.log(`[publish-api] listening http://${shown}  db=${app.config.dbPath}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[publish-api] ${signal} 收到，正在退出`);
    app.close();
    process.exit(0);
  });
}
