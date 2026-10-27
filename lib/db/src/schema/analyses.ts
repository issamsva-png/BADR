import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  int,
  json,
  mysqlTable,
  double,
  text,
  datetime,
  varchar,
} from "drizzle-orm/mysql-core";

export const analysesTable = mysqlTable("document_analyses", {
  id: varchar("id", { length: 36 }).$defaultFn(randomUUID).primaryKey(),
  ownerId: varchar("owner_id", { length: 255 }).notNull(),
  mode: varchar("mode", { length: 32 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  conclusion: text("conclusion"),
  conclusionRationale: text("conclusion_rationale"),
  alternativeExplanation: text("alternative_explanation"),
  additionalVerification: text("additional_verification"),
  operationalAction: text("operational_action"),
  automaticReview: json("automatic_review")
    .$type<Record<string, unknown> | null>()
    .default(null),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export const analysisDocumentsTable = mysqlTable("analysis_documents", {
  id: varchar("id", { length: 36 }).$defaultFn(randomUUID).primaryKey(),
  analysisId: varchar("analysis_id", { length: 36 })
    .notNull()
    .references(() => analysesTable.id, { onDelete: "cascade" }),
  ownerId: varchar("owner_id", { length: 255 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 127 }).notNull(),
  size: int("size").notNull(),
  objectPath: varchar("object_path", { length: 512 }).notNull().unique(),
  category: varchar("category", { length: 255 }).notNull(),
  pageCount: int("page_count").notNull().default(0),
  extractedText: text("extracted_text"),
  extractedFields: json("extracted_fields")
    .$type<Record<string, unknown>>()
    .notNull(),
  controlStatus: json("control_status")
    .$type<Record<string, unknown>>()
    .notNull(),
  reviewConclusion: varchar("review_conclusion", { length: 80 }),
  reviewRationale: text("review_rationale"),
  reviewAlternativeExplanation: text("review_alternative_explanation"),
  reviewVerification: text("review_verification"),
  reviewAction: text("review_action"),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export const analysisObservationsTable = mysqlTable("analysis_observations", {
  id: varchar("id", { length: 36 }).$defaultFn(randomUUID).primaryKey(),
  analysisId: varchar("analysis_id", { length: 36 })
    .notNull()
    .references(() => analysesTable.id, { onDelete: "cascade" }),
  documentId: varchar("document_id", { length: 36 }).references(() => analysisDocumentsTable.id, {
    onDelete: "set null",
  }),
  ownerId: varchar("owner_id", { length: 255 }).notNull(),
  classification: varchar("classification", { length: 32 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  page: int("page"),
  field: text("field"),
  observedValue: text("observed_value"),
  description: text("description").notNull(),
  method: text("method").notNull(),
  confidence: double("confidence"),
  resolved: boolean("resolved").notNull().default(false),
  source: varchar("source", { length: 32 }).notNull().default("analyst"),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export const documentUploadReservationsTable = mysqlTable(
  "document_upload_reservations",
  {
    id: varchar("id", { length: 36 }).$defaultFn(randomUUID).primaryKey(),
    ownerId: varchar("owner_id", { length: 255 }).notNull(),
    objectPath: varchar("object_path", { length: 512 }).notNull().unique(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
);
