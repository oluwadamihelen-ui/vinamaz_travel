process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://vinamaz:vinamaz@localhost:5432/vinamaz_test";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
import os from "node:os";
import path from "node:path";
process.env.PRIVATE_STORAGE_DIR ??= path.join(os.tmpdir(), "vinamaz-test-private-docs");
