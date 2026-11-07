/**
 * Standalone-script environment bootstrap: ensures DATABASE_URL points at
 * the application database when the process was started without it.
 * Import at the TOP of scripts/ai-workers/*.ts before any db access.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'
}

export {}
