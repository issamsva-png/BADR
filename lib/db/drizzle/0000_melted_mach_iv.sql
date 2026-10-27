CREATE TABLE `document_analyses` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`mode` varchar(32) NOT NULL,
	`title` varchar(160) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`conclusion` text,
	`conclusion_rationale` text,
	`alternative_explanation` text,
	`additional_verification` text,
	`operational_action` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `document_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analysis_documents` (
	`id` varchar(36) NOT NULL,
	`analysis_id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`mime_type` varchar(127) NOT NULL,
	`size` int NOT NULL,
	`object_path` varchar(512) NOT NULL,
	`category` varchar(255) NOT NULL,
	`page_count` int NOT NULL DEFAULT 0,
	`extracted_text` text,
	`extracted_fields` json NOT NULL,
	`control_status` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `analysis_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `analysis_documents_object_path_unique` UNIQUE(`object_path`)
);
--> statement-breakpoint
CREATE TABLE `analysis_observations` (
	`id` varchar(36) NOT NULL,
	`analysis_id` varchar(36) NOT NULL,
	`document_id` varchar(36),
	`owner_id` varchar(255) NOT NULL,
	`classification` varchar(32) NOT NULL,
	`severity` varchar(16) NOT NULL DEFAULT 'medium',
	`page` int,
	`field` text,
	`observed_value` text,
	`description` text NOT NULL,
	`method` text NOT NULL,
	`confidence` double,
	`resolved` boolean NOT NULL DEFAULT false,
	`source` varchar(32) NOT NULL DEFAULT 'analyst',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `analysis_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_upload_reservations` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`object_path` varchar(512) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `document_upload_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_upload_reservations_object_path_unique` UNIQUE(`object_path`)
);
--> statement-breakpoint
ALTER TABLE `analysis_documents` ADD CONSTRAINT `analysis_documents_analysis_id_document_analyses_id_fk` FOREIGN KEY (`analysis_id`) REFERENCES `document_analyses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `analysis_observations` ADD CONSTRAINT `analysis_observations_analysis_id_document_analyses_id_fk` FOREIGN KEY (`analysis_id`) REFERENCES `document_analyses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `analysis_observations` ADD CONSTRAINT `analysis_observations_document_id_analysis_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `analysis_documents`(`id`) ON DELETE set null ON UPDATE no action;