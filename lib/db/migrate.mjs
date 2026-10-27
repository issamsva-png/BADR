import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";

const requiredEnv = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  throw new Error(`Missing MySQL configuration: ${missingEnv.join(", ")}`);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("./drizzle", import.meta.url)),
  });
  console.log("MySQL migrations applied.");
} finally {
  await pool.end();
}
