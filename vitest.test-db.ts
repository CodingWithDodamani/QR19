// Single source of truth for the isolated vitest SQLite file.
// Resolved relative to prisma/schema.prisma (like DATABASE_URL), so this
// lands in node_modules/.cache — gitignored and excluded from export-source.sh.
export const TEST_DATABASE_URL = "file:../../node_modules/.cache/vitest-test.db";
