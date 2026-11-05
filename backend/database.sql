CREATE DATABASE IF NOT EXISTS examguard
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE examguard;

CREATE TABLE IF NOT EXISTS students (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    student_number VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    class_name VARCHAR(80) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_students_student_number (student_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS monitoring_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    student_id INT UNSIGNED NOT NULL,
    activity VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'safe',
    detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_monitoring_logs_detected_at (detected_at),
    KEY idx_monitoring_logs_student_id (student_id),
    CONSTRAINT fk_monitoring_logs_student
        FOREIGN KEY (student_id) REFERENCES students (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS violations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    student_id INT UNSIGNED NOT NULL,
    type VARCHAR(255) NOT NULL,
    detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_violations_detected_at (detected_at),
    KEY idx_violations_student_id (student_id),
    CONSTRAINT fk_violations_student
        FOREIGN KEY (student_id) REFERENCES students (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_presence (
    student_id INT UNSIGNED NOT NULL,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id),
    KEY idx_student_presence_last_seen (last_seen_at),
    CONSTRAINT fk_student_presence_student
        FOREIGN KEY (student_id) REFERENCES students (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_violation_state (
    student_id INT UNSIGNED NOT NULL,
    indication_count INT UNSIGNED NOT NULL DEFAULT 0,
    permanently_violating TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (student_id),
    CONSTRAINT fk_student_violation_state_student
        FOREIGN KEY (student_id) REFERENCES students (id)
) ENGINE=InnoDB;
