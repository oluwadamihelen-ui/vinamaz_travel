process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://vinamaz:vinamaz@localhost:5432/vinamaz_test";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
import os from "node:os";
import path from "node:path";
process.env.PRIVATE_STORAGE_DIR ??= path.join(os.tmpdir(), "vinamaz-test-private-docs");

process.env.PAYSTACK_SECRET_KEY = "sk_test_paystack_secret";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-flutterwave-secret";
process.env.FLUTTERWAVE_SECRET_HASH = "flw-webhook-secret-hash";
process.env.KORAPAY_SECRET_KEY = "sk_test_korapay_secret";
process.env.NEXT_PUBLIC_APP_URL = "https://vinamaz.test";
