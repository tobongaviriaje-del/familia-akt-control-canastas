# API security acceptance tests

These are the security gates for the API hardening work. Run only against a local test server with a temporary DATA_DIR. Do not run against Railway or the live Render URL.

## Required behavior before production

- Anonymous GET /api/state is denied and does not reveal users, passwords, tasks, catalog, or deliveries.
- Anonymous PUT /api/state is denied and cannot alter any persisted value.
- Anonymous POST /api/jornada/cerrar is denied and cannot archive or remove tasks.
- Successful login issues a server-managed session cookie with HttpOnly, SameSite, and Secure in production.
- Logout invalidates the session.
- API responses never contain plaintext passwords, password hashes, session IDs, or other authentication secrets.
- Role authorization is enforced on the server, not inferred from client-side UI:
  - Admin may manage users and standards/catalog.
  - Operational roles may perform only their existing permitted task/delivery actions.
  - Patinador writes are limited to their assigned areas/puestos.
  - Only an explicitly authorized role may close a shift.
- Invalid JSON, oversized bodies, unknown fields, and invalid state shapes are rejected without partial writes.
- Existing data fields—including historical task metadata and CR4 125 basket/reference information—survive updates and restart tests.
- Tests use synthetic data only; production data must never be copied into the test fixture.

## Migration gates

- Do not merge or deploy until the server and every frontend caller are migrated together.
- Render must have verified durable storage or a database and a tested backup/restore procedure before being considered a production replacement.
- Railway remains untouched until the user explicitly approves a tested cutover.
