import { defineConfig } from "drizzle-kit";

const requiredMysqlEnv = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"] as const;
const missingMysqlEnv = requiredMysqlEnv.filter((key) => !process.env[key]);
if (missingMysqlEnv.length > 0) {
  throw new Error(`Missing MySQL configuration: ${missingMysqlEnv.join(", ")}`);
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "mysql",
  dbCredentials: {
    host: process.env.MYSQL_HOST!,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE!,
  },
});
