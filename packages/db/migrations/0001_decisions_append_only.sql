CREATE FUNCTION decisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decisions is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decisions_no_update_delete
BEFORE UPDATE OR DELETE ON decisions
FOR EACH ROW EXECUTE FUNCTION decisions_append_only();
