/** Timestamped step logger. Levels: 🎬 step, ✅ success, ⏭ skip, ⚠️ warn, ❌ error, ℹ️ info */

const ts = (): string => new Date().toISOString().slice(11, 19);

export const logger = {
  step: (msg: string): void =>
    console.log(`[${ts()}] 🎬 ${msg}`),

  success: (msg: string): void =>
    console.log(`[${ts()}] ✅ ${msg}`),

  skip: (msg: string): void =>
    console.log(`[${ts()}] ⏭  ${msg}`),

  warn: (msg: string): void =>
    console.warn(`[${ts()}] ⚠️  ${msg}`),

  error: (msg: string): void =>
    console.error(`[${ts()}] ❌ ${msg}`),

  info: (msg: string): void =>
    console.log(`[${ts()}] ℹ️  ${msg}`),
};
