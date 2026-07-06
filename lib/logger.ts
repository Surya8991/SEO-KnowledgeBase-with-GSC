/**
 * Minimal structured logger. Replaces ad-hoc console.log/warn calls with
 * something a future log-drain (Better Stack / Axiom / etc.) can parse.
 *
 * Levels: debug | info | warn | error. Default min-level is "info" in prod,
 * "debug" in dev — controlled by LOG_LEVEL env var.
 *
 * Output is one JSON object per line on stdout (info+) or stderr (warn/error)
 * so Vercel's runtime logs split naturally between the two.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;
  const line = JSON.stringify({
    level,
    msg,
    ...(ctx ? { ctx } : {}),
  });
  if (level === "warn" || level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => emit("info",  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit("warn",  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
