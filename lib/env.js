// Loads .env from the project root (local dev). On Vercel, env vars come from the dashboard instead.
try { process.loadEnvFile(); } catch { /* no .env file — fine */ }