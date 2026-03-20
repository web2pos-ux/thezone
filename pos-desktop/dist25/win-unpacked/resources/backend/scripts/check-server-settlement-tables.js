const { dbAll } = require('../db');

async function main() {
  const rows = await dbAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('server_shifts','server_settlements','settlement_payments','server_cash_drops','audit_log')"
  );
  console.log(rows.map((r) => r.name));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

