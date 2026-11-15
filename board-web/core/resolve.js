/*
  派生规则（渲染端算时间，服务端不猜）
  ---------------------------------------------------------------
  为什么全放这：倒计时天数、今天第几节、今天上什么课、问候语，都是"同一份数据 + 当前时间"
  的函数。老师端不该填"还剩 97 天"，大屏也不该问服务端"今天星期几"。
  规则表见 docs/board-v2.md 第 2 节，改规则只改这里。
*/
window.BoardResolve = (function () {
  var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function parseDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(date.getTime()) ? null : date;
  }

  /* 1=周一 … 7=周日（Date.getDay() 的 0 是周日，直接换成 7 才好和课表对齐） */
  function weekdayOf(date) {
    var day = date.getDay();
    return day === 0 ? 7 : day;
  }

  /* 按日历日算差，忽略时分秒：今天到考试前一天 = 1 */
  function daysUntil(targetText, now) {
    var target = parseDate(targetText);
    if (!target) return null;
    var a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((b - a) / 86400000);
  }

  function formatMonthDay(text) {
    var date = parseDate(text);
    if (!date) return String(text || "");
    return date.getMonth() + 1 + "月" + date.getDate() + "日";
  }

  function subjectMap(state) {
    var map = {};
    (state.subjects || []).forEach(function (subject) {
      if (subject && subject.id) map[subject.id] = subject;
    });
    return map;
  }

  function greetingOf(now) {
    var hour = now.getHours();
    if (hour < 5) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 13) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function countdownOf(state, now) {
    var cd = state.countdown;
    if (!cd || !cd.date) return null;
    var days = daysUntil(cd.date, now);
    if (days === null || days < 0) return null; // 日期过了就不挂一个"还剩 -3 天"的假东西
    var target = parseDate(cd.date);
    var sameYear = target.getFullYear() === now.getFullYear();
    // 副标题给考试那天本身（1月15日），别再重复一遍"还剩 N 天"——数字已经在大字里了
    var sub = (sameYear ? "" : target.getFullYear() + "年") + (target.getMonth() + 1) + "月" + target.getDate() + "日";
    return {
      days: days,
      label: cd.label || "重要日子",
      sub: days === 0 ? "就是今天" : sub,
    };
  }

  /*
    今天的课：先看这一天有没有"特殊安排"，再看周课表。
    overrides[date] 三种写法，可叠加（periods 最优先）：
      off: true             → 今天不上课（工作日放假）
      useWeekday: 1..7      → 今天照那一周的课表上（周末调休补课最常用）
      periods: [科目id…]    → 今天这几节临时换掉（单双周、临时调课）
    没有安排就按系统日期的星期几取课；周末没排课就是没课，不再拿周一顶。
  */
  function planOf(state, now) {
    var weekday = weekdayOf(now);
    var map = subjectMap(state);
    var today = dateKey(now);
    var override = null;
    (state.overrides || []).forEach(function (item) {
      if (item && item.date === today) override = item;
    });

    var off = Boolean(override && override.off === true);
    var baseWeekday = weekday;
    if (!off && override && override.useWeekday) baseWeekday = Number(override.useWeekday) || weekday;

    var ids = null;
    if (!off) {
      if (override && Array.isArray(override.periods)) ids = override.periods;
      if (!ids) ids = (state.schedule || {})[String(baseWeekday)] || [];
    }

    var entries = [];
    (ids || []).forEach(function (id, index) {
      entries.push({ index: index + 1, id: id || "", subject: (id && map[id]) || null });
    });
    while (entries.length && !entries[entries.length - 1].id) entries.pop();

    var hasLesson = entries.some(function (entry) {
      return entry.id;
    });

    return {
      weekday: weekday,
      weekdayCn: WEEK_CN[weekday % 7],
      baseWeekday: baseWeekday,
      baseWeekdayCn: WEEK_CN[baseWeekday % 7],
      entries: entries,
      off: off,
      fromOverride: Boolean(override),
      badge: badgeOf(override, off, baseWeekday, weekday, hasLesson),
      empty: off || !hasLesson,
    };
  }

  /* 大屏头部那枚小标：只在"今天跟平常不一样"时出现，不解释、不啰嗦 */
  function badgeOf(override, off, baseWeekday, weekday, hasLesson) {
    if (off) return "放假";
    if (!override) return "";
    /* 当天一节都没排（比如调休放掉的周末）就别贴"临时换课"，那是误导 */
    if (!hasLesson) return "";
    if (override.useWeekday && baseWeekday !== weekday) return "调休 · 上" + WEEK_CN[baseWeekday % 7] + "的课";
    if (Array.isArray(override.periods)) return "临时换课";
    return "";
  }

  /* 当前上到第几节：用 periods 的 start/end 和系统时间比 */
  function currentPeriodOf(state, now) {
    var minute = now.getHours() * 60 + now.getMinutes();
    var hit = null;
    (state.periods || []).forEach(function (period) {
      var start = toMinute(period.start);
      var end = toMinute(period.end);
      if (start === null || end === null) return;
      if (minute >= start && minute < end) hit = period.index;
    });
    return hit;
  }

  function toMinute(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function derive(state, now) {
    return {
      dateKey: dateKey(now),
      dateCn: now.getMonth() + 1 + "月" + now.getDate() + "日 " + WEEK_CN[now.getDay()],
      weekday: weekdayOf(now),
      greeting: greetingOf(now),
      countdown: countdownOf(state, now),
      plan: planOf(state, now),
      currentPeriod: currentPeriodOf(state, now),
      subjects: subjectMap(state),
    };
  }

  return {
    derive: derive,
    subjectMap: subjectMap,
    daysUntil: daysUntil,
    formatMonthDay: formatMonthDay,
    dateKey: dateKey,
    parseDate: parseDate,
    weekdayOf: weekdayOf,
  };
})();
