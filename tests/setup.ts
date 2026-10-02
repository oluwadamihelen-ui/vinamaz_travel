process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://vinamaz:vinamaz@localhost:5432/vinamaz_test";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
