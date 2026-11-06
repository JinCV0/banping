// 统一的错误形状：{ error: { code, message, details? } }
// 前端只认 code，message 给人看。
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "未登录或会话已过期") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "没有权限做这件事") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "不存在") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);
// 403 但语义独立：这把开通密钥已经建过班了（一钥一班）。前端可以据此直接提示"用班级码登录"，
// 不必和"密钥无效/没配种子"混在一个 FORBIDDEN 里。
export const claimTaken = (message, details) => new ApiError(403, "CLAIM_TAKEN", message, details);

export function assert(condition, error) {
  if (!condition) throw error;
}
