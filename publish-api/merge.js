// 谁能改哪一块：这里只回答"这份报文落库前长什么样"，不碰存储与网络。
// 班主任（owner）改全量；任课老师（member）只能改自己那一科的作业条目与科目通知，
// 其余字段一律沿用上一版——科任老师误传了整份旧数据也不会把别的科覆盖掉。
// v2 里科目靠 id 引用：state.subjects = [{id,name,color}]，今天的作业在 today.homework[]。
import { forbidden, conflict } from "./errors.js";

export function isEmpty(state) {
  return !state || typeof state !== "object";
}

function homeworkOf(state) {
  return Array.isArray(state?.today?.homework) ? state.today.homework : [];
}

// 账号里存的 subject 可能是科目 id（新老师端直接传 id），也可能是科目名（老账号存的"语文"）。
// 两种都认：先按 id 找，再按名字找，返回科目表里的 id。
export function resolveSubjectId(state, subject) {
  const raw = String(subject || "").trim();
  if (!raw) return null;
  const list = Array.isArray(state?.subjects) ? state.subjects : [];
  if (list.some((item) => item?.id === raw)) return raw;
  return list.find((item) => item?.name === raw)?.id ?? null;
}

// 用 incoming 里属于 subject 的那一条替换 existing 里的同一条；只取 items 与 note。
export function mergeSubjectEdit(existing, incoming, subject) {
  const subjectId = resolveSubjectId(existing, subject) ?? resolveSubjectId(incoming, subject);
  if (!subjectId) {
    throw forbidden(`班级科目表里没有「${subject}」这一科，请让班主任先在班级设置里加上`);
  }

  const target = homeworkOf(incoming).find((item) => item?.subject === subjectId);
  if (!target) {
    throw forbidden(`这次提交里没有「${subjectId}」这一科的作业，只有班主任能改别的板块`);
  }

  // 基座永远是已发布的那一版：别的科目、课表、通知、主题都动不了
  const next = structuredClone(existing);
  if (!next.today || typeof next.today !== "object" || typeof next.today.date !== "string") {
    throw forbidden("班主任还没有发布过今天这一天的看板，请等班主任先发布一次");
  }

  const homework = next.today.homework.slice();
  const patch = { items: Array.isArray(target.items) ? target.items : [] };
  // note 是这一科的"科目通知"，由该科老师自己发；没带这个字段就保留上一版的
  if (Object.prototype.hasOwnProperty.call(target, "note")) patch.note = target.note;

  const index = homework.findIndex((item) => item?.subject === subjectId);
  // 以原来那条为底再盖 patch：没带 note 时上一版的科目通知不会被抹掉
  if (index >= 0) homework[index] = { ...homework[index], subject: subjectId, ...patch };
  else homework.push({ subject: subjectId, ...patch });
  next.today.homework = homework;
  return next;
}

export function applyRevisionGuard(existing, ifRevision) {
  if (ifRevision === undefined || ifRevision === null) return;
  const current = existing?.revision ?? 0;
  if (Number(ifRevision) !== current) {
    throw conflict("STALE", `看板已被更新（当前 revision=${current}），请刷新后再发布`, {
      revision: current,
    });
  }
}
