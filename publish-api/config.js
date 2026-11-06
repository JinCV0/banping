// 配置只有一个来源：环境变量；没有就落到"本机能直接跑"的默认值。
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HOUR = 3600 * 1000;

// 平台容器（Railway / Fly / Render / Cloud Run）里不设 HOST 时必须监听 0.0.0.0，
// 否则平台的健康检查从容器外连不上，部署看起来"起来了"却一直是 502。
const PLATFORM_ENV = ["RAILWAY_ENVIRONMENT", "FLY_APP_NAME", "RENDER", "K_SERVICE"];

function resolveHost(env) {
  if (env.HOST) return env.HOST;
  return PLATFORM_ENV.some((key) => env[key]) ? "0.0.0.0" : "127.0.0.1";
}

export function loadConfig(env = process.env) {
  return {
    host: resolveHost(env),
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || path.join(HERE, "data", "publish.db"),
    // 开班级密钥的"规律种子"：服务器只存种子，校验 verifyClaimKey()，不存任何发出去的密钥。
    // 没配就谁也不能建班（防止公网被陌生人占号）。
    claimKeySecret: (env.CLAIM_KEY_SECRET || "").trim(),
    // 建班时给这个班写死的服务期（天），默认一年；密钥本身不带日期
    licenseDays: Math.max(1, Number(env.LICENSE_DAYS || 365) || 365),
    // 老师端会话：默认一周，够一个教学周不用反复登录
    sessionTtlMs: Number(env.SESSION_TTL_HOURS || 168) * HOUR,
    // 大屏配对认领（claim）的有效期：默认 10 分钟。
    // 方向是"大屏显示码、老师手机扫码"，所以这 10 分钟是给老师找手机、扫码、登录用的。
    pairTtlMs: Number(env.CLAIM_TTL_MINUTES || env.PAIR_TTL_MINUTES || 10) * 60 * 1000,
    // 配对码是公开接口：按 IP 限流，防止有人枚举 6 位码把别人的屏抢走
    claimRateLimit: Math.max(1, Number(env.CLAIM_RATE_LIMIT || 5) || 5),
    claimRateWindowMs: Number(env.CLAIM_RATE_WINDOW_MINUTES || 10) * 60 * 1000,
    // 全局挂起的认领上限：再多人同时开屏也只占这么多行，防内存/表膨胀
    claimPendingMax: Math.max(1, Number(env.CLAIM_PENDING_MAX || 2000) || 2000),
    // 单份看板数据上限：8 个板块的文本，64KB 已经远超真实用量
    maxBodyBytes: Number(env.MAX_BODY_KB || 64) * 1024,
    now: () => Date.now(),
  };
}
