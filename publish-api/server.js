// 装配层：配置 → 库 → 路由表 → HTTP 服务。这里只接线，不含业务逻辑。
import http from "node:http";
import { loadConfig } from "./config.js";
import { openStore } from "./store.js";
import { loadSchema } from "./validate.js";
import { createEventHub } from "./events.js";
import { createRouter } from "./http.js";
import { createStaticHandler } from "./static.js";
import { authRoutes } from "./routes-auth.js";
import { boardRoutes } from "./routes-board.js";
import { teacherRoutes } from "./routes-teachers.js";
import { upgradeStoredStates } from "./migrate.js";

export function createServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const store = overrides.store ?? openStore(config.dbPath);
  // 老班级没有到期日（改版前建的）：补一个，建班时间 + 服务期；早就过期的给 30 天缓冲
  store.classes.backfillExpiry({
    now: config.now(),
    span: config.licenseDays * 86_400_000,
    grace: 30 * 86_400_000,
  });
  // 老库里的快照（v1 的"10月26日 周一 / 16:07"定格数据、v2 的三栏版面）在启动时逐级升到 v3，幂等
  const migrated = upgradeStoredStates(store, config.now());
  for (const item of migrated.failed) {
    console.error("[publish-api] 老快照升级失败，保持原样:", item.classId, item.errors.join("; "));
  }
  if (migrated.upgraded.length) {
    const from = [...new Set(migrated.upgraded.map((item) => `v${item.from}`))].join(" / ");
    console.log(`[publish-api] ${from} → v3 升级了 ${migrated.upgraded.length} 份看板快照（revision +1）`);
  }
  const schema = loadSchema(overrides.schemaPath);
  const events = createEventHub();
  const routes = [
    ...authRoutes({ config }),
    ...teacherRoutes({ config }),
    ...boardRoutes({ config, schema }),
  ];
  const handle = createRouter({ routes, store, config, events });
  const serve = createStaticHandler(overrides.staticOptions);

  const server = http.createServer(async (req, res) => {
    try {
      if (await serve(req, res)) return; // h5 与 /board/ 静态资源
      await handle(req, res);
    } catch (error) {
      console.error("[publish-api] 请求处理失败:", error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"code":"INTERNAL"}}');
    }
  });

  return {
    server,
    config,
    store,
    events,
    listen: (port = config.port, host = config.host) =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => {
      server.closeAllConnections?.();
      server.close();
      store.close();
    },
  };
}
