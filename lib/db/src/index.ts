import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const { createPool } = mysql;
const requiredMysqlEnv = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"] as const;
const missingMysqlEnv = requiredMysqlEnv.filter((key) => !process.env[key]);
if (missingMysqlEnv.length > 0) {
  throw new Error(
    `Missing MySQL configuration: ${missingMysqlEnv.join(", ")}`,
  );
}

export const pool = createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});
export const db = drizzle(pool, { schema, mode: "default" });

export * from "./schema";
