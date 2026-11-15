// 校验层：直接读 board-web 那份 schema 做校验，不另抄一份规则。
// 只实现 schema 里实际用到的关键字（type/const/enum/pattern/minLength/maxLength/
// minimum/maximum/minItems/maxItems/items/required/additionalProperties/$ref），
// 这样"契约"只有一处，渲染层与发布层不会各说各话。
// 注意：v3 schema 同样刻意避开了 oneOf / anyOf / format，就是为了这份 mini-validator 不用长大；
// 以后要加这些关键字，先在这里补实现，再改 schema。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.join(HERE, "..", "board-web", "schema", "board-state.v3.schema.json");

export function loadSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  return { schema, path: schemaPath };
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`不支持的 $ref: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, key) => node?.[key], root);
}

// 返回 [{ path, message }]，空数组即通过
export function validate(schema, value, root = schema, at = "") {
  if (schema.$ref) return validate(resolveRef(schema.$ref, root), value, root, at);

  const errors = [];
  const push = (message) => errors.push({ path: at || "$", message });

  if (schema.type && !matchesType(value, schema.type)) {
    push(`类型应为 ${schema.type}，实际是 ${typeOf(value)}`);
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const) push(`必须是 ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) push(`必须是 ${schema.enum.join(" / ")} 之一`);

  if (typeof value === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      push(`文字超过上限：${value.length} > ${schema.maxLength} 字`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      push(`文字少于下限：${value.length} < ${schema.minLength} 字`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`不符合格式 ${schema.pattern}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) push(`不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) push(`不能大于 ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      push(`条目过多：${value.length} > ${schema.maxItems}`);
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      push(`条目过少：${value.length} < ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validate(schema.items, item, root, `${at}[${index}]`)));
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) push(`缺少必填字段 ${key}`);
    }
    const props = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = props[key];
      if (childSchema) {
        errors.push(...validate(childSchema, child, root, `${at}.${key}`));
      } else if (schema.additionalProperties === false) {
        push(`不认识的字段 ${key}`);
      } else if (typeof schema.additionalProperties === "object") {
        errors.push(...validate(schema.additionalProperties, child, root, `${at}.${key}`));
      }
    }
  }

  return errors;
}

export function validateBoardState(state, loaded = loadSchema()) {
  const errors = validate(loaded.schema, state, loaded.schema, "");
  return { ok: errors.length === 0, errors };
}

/*
  契约只能管"像不像日期"（YYYY-MM-DD），管不了 2 月 30 日这种根本不存在的日子。
  校历里的日期要跟"今天"逐字比对才命中，写错了不报错、只会永远不生效——
  所以这里补一道语义校验：日历上不存在的日子不让存。
*/
export function invalidOverrideDates(state) {
  const list = state?.overrides;
  if (!Array.isArray(list)) return [];
  const bad = [];
  for (const item of list) {
    const text = typeof item?.date === "string" ? item.date : "";
    const parts = text.split("-");
    if (parts.length !== 3) continue; // 形状不对交给 schema 报
    const [y, m, d] = parts.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) bad.push(text);
  }
  return bad;
}
