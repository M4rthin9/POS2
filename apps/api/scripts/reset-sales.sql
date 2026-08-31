-- Wipe all sale history and start a fresh ledger for a new shop.
--
--   npx wrangler d1 execute pos2-db --local  --file apps/api/scripts/reset-sales.sql
--   npx wrangler d1 execute pos2-db --remote --file apps/api/scripts/reset-sales.sql
--
-- Removes: sales, their items and tenders, closed Z-reports, the audit log and
-- the vestigial bank-reconciliation rows that reference sales.
-- Keeps: products and stock, users, divisions, events, settings.
--
-- Safe for the hash chain. chainTail() in apps/api/src/lib/ledger.ts falls back
-- to { seq: 0, hash: GENESIS_HASH } when no sealed rows remain, so the next sale
-- seals at seq = 1 from genesis. Deleting only *some* sales would instead break
-- verifyChain() — this script must remove all of them or none.
--
-- Also clear each POS device's local state afterwards (Settings →
-- "ล้างข้อมูลในเครื่อง"), or a queued offline sale will replay into the new ledger.

DELETE FROM reconciliation_records;
DELETE FROM bank_statement_lines;
DELETE FROM bank_import_batches;
DELETE FROM sale_payments;
DELETE FROM sale_items;
DELETE FROM sales;
DELETE FROM z_reports;
DELETE FROM audit_log;

-- Restart receipt numbering at 1. sale.id is part of the hash input, so this
-- only makes sense on an emptied sales table.
DELETE FROM sqlite_sequence
WHERE name IN ('sales', 'sale_items', 'sale_payments', 'z_reports', 'audit_log',
               'reconciliation_records', 'bank_statement_lines', 'bank_import_batches');
