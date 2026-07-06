import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

/** Apply every drizzle/*.sql migration in lexical order. Idempotent. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example → .env).");

  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const sql = neon(url);
  let total = 0;
  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf8");
    // Strip line comments FIRST, then split on `;` at end-of-statement.
    // Older split-then-strip order let a trailing `-- comment` after `;`
    // keep the next statement attached, which Neon's prepared protocol
    // rejects with "cannot insert multiple commands".
    const statements = raw
      .replace(/--.*$/gm, "")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    console.log(`\n— ${file}`);
    for (const stmt of statements) {
      process.stdout.write(`  → ${stmt.split("\n")[0].slice(0, 70)}...\n`);
      await sql.query(stmt);
      total++;
    }
  }
  console.log(`\n✓ Applied ${total} statements across ${files.length} files. Database ready.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
