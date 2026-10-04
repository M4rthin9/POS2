-- Cut D1 rows read: date filters now compare created_at directly, so give the
-- planner indexes it can range-scan instead of walking every sale.

-- Per-event "today" counts and MAX(created_at) become index range lookups.
-- Supersedes the single-column event index (same leftmost column).
CREATE INDEX IF NOT EXISTS idx_sales_event_created ON sales(event_id, created_at);
DROP INDEX IF EXISTS idx_sales_event;

-- Nearly every row is COMPLETED, so this index never narrows anything, yet the
-- planner prefers its equality match over the created_at range and ends up
-- scanning the whole table.
DROP INDEX IF EXISTS idx_sales_status;

PRAGMA optimize;
