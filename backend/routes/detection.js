const express = require("express");
const db = require("../config/db");
const {
    getStudentIdForSlot,
    getMappedStudentIds,
    replaceStudentMappings
} = require("../studentMappings");

const router = express.Router();
const activeLogIds = new Map();
const allowedStatuses = new Set(["safe", "warning", "violation"]);

router.post("/presence", (req, res) => {
    const objects = req.body.objects;
    if (!Array.isArray(objects) || objects.length > 10 ||
        objects.some((objectNumber) =>
            !Number.isInteger(objectNumber) || objectNumber < 1 || objectNumber > 10
        )) {
        return res.status(400).json({
            message: "Daftar slot siswa aktif tidak valid"
        });
    }

    const studentIds = [...new Set(objects
        .map(getStudentIdForSlot)
        .filter(Boolean))];
    const mappedStudentIds = getMappedStudentIds();
    if (mappedStudentIds.length === 0) {
        return res.json({ connected_devices: 0 });
    }

    const mappedPlaceholders = mappedStudentIds.map(() => "?").join(", ");
    const activePlaceholders = studentIds.map(() => "?").join(", ");
    const deleteSql = studentIds.length
        ? `DELETE FROM student_presence
           WHERE student_id IN (${mappedPlaceholders})
             AND student_id NOT IN (${activePlaceholders})`
        : `DELETE FROM student_presence
           WHERE student_id IN (${mappedPlaceholders})`;
    const deleteParams = studentIds.length
        ? [...mappedStudentIds, ...studentIds]
        : mappedStudentIds;

    db.query(deleteSql, deleteParams, (deleteError) => {
        if (deleteError) {
            console.error("Error menghapus status siswa yang tidak aktif:", deleteError);
            return res.status(500).json({
                message: "Gagal memperbarui status siswa aktif"
            });
        }

        if (studentIds.length === 0) {
            return res.json({ connected_devices: 0 });
        }

        const values = studentIds.map(() => "(?, CURRENT_TIMESTAMP)").join(", ");
        const sql = `
            INSERT INTO student_presence (student_id, last_seen_at)
            VALUES ${values}
            ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP
        `;
        db.query(sql, studentIds, (err) => {
            if (err) {
                console.error("Error memperbarui siswa aktif:", err);
                return res.status(500).json({
                    message: "Gagal memperbarui status siswa aktif"
                });
            }

            res.json({ connected_devices: studentIds.length });
        });
    });
});

router.post("/mappings", (req, res) => {
    const mappings = req.body.mappings;
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
        return res.status(400).json({
            message: "Pemetaan slot siswa tidak valid"
        });
    }

    const nextMappings = new Map();
    for (const [slot, studentId] of Object.entries(mappings)) {
        const slotNumber = Number(slot);
        if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 10) {
            return res.status(400).json({
                message: "Nomor slot harus berada di antara 1 sampai 10"
            });
        }
        if (studentId === "" || studentId === null) {
            continue;
        }

        const normalizedStudentId = Number(studentId);
        if (!Number.isInteger(normalizedStudentId) || normalizedStudentId < 1) {
            return res.status(400).json({
                message: `Siswa untuk slot ${slotNumber} tidak valid`
            });
        }
        nextMappings.set(String(slotNumber), normalizedStudentId);
    }

    replaceStudentMappings(nextMappings);

    res.json({ message: "Pemetaan siswa tersimpan" });
});

router.post("/", (req, res) => {
    const objectNumber = Number(req.body.object);
    const { status, reason, event_id: eventId } = req.body;
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";

    if (!Number.isInteger(objectNumber) || objectNumber < 1 ||
        !allowedStatuses.has(status) ||
        !normalizedReason || normalizedReason.length > 255 ||
        typeof eventId !== "string" || !eventId || eventId.length > 80) {
        return res.status(400).json({
            message: "Data deteksi tidak valid"
        });
    }

    const studentId = getStudentIdForSlot(objectNumber);
    if (!studentId) {
        emitDetection(req, objectNumber, status, normalizedReason, eventId);
        return res.status(202).json({
            message: "Deteksi diterima, tetapi slot belum dipetakan ke siswa"
        });
    }

    const activeLog = activeLogIds.get(eventId);
    if (activeLog) {
        return updateMonitoringLog(
            activeLog,
            normalizedReason,
            status,
            eventId,
            req,
            res
        );
    }
    if (status === "safe") {
        activeLogIds.delete(eventId);
        return res.json({ message: "Status deteksi diperbarui" });
    }

    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            console.error("Gagal mendapatkan koneksi database untuk deteksi:", connectionError);
            return res.status(500).json({
                message: "Gagal menyimpan deteksi ke database"
            });
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                console.error("Gagal memulai transaksi deteksi:", transactionError);
                return res.status(500).json({
                    message: "Gagal menyimpan deteksi ke database"
                });
            }

            recordStudentIndication(connection, studentId, (indicationError, permanentlyViolating) => {
                if (indicationError) {
                    return rollbackDetection(
                        connection,
                        res,
                        "Error menghitung indikasi pelanggaran siswa:",
                        indicationError
                    );
                }

                const effectiveStatus = permanentlyViolating ? "violation" : "warning";
                connection.query(
                    `INSERT INTO monitoring_logs (student_id, activity, status)
                     VALUES (?, ?, ?)`,
                    [studentId, normalizedReason, effectiveStatus],
                    (logError, result) => {
                        if (logError) {
                            return rollbackDetection(
                                connection,
                                res,
                                "Error menyimpan deteksi ke log aktivitas:",
                                logError
                            );
                        }

                        if (permanentlyViolating) {
                            return connection.query(
                                "INSERT INTO violations (student_id, type) VALUES (?, ?)",
                                [studentId, normalizedReason],
                                (violationError) => {
                                    if (violationError) {
                                        return rollbackDetection(
                                            connection,
                                            res,
                                            "Error menyimpan pelanggaran deteksi:",
                                            violationError
                                        );
                                    }
                                    commitDetectionLog(
                                        connection,
                                        result,
                                        studentId,
                                        objectNumber,
                                        eventId,
                                        normalizedReason,
                                        effectiveStatus,
                                        req,
                                        res,
                                        true
                                    );
                                }
                            );
                        }

                        commitDetectionLog(
                            connection,
                            result,
                            studentId,
                            objectNumber,
                            eventId,
                            normalizedReason,
                            effectiveStatus,
                            req,
                            res,
                            false
                        );
                    }
                );
            });
        });
    });
});

function recordStudentIndication(connection, studentId, callback) {
    connection.query(
        `INSERT INTO student_violation_state (student_id, indication_count)
         VALUES (?, 1)
         ON DUPLICATE KEY UPDATE indication_count = indication_count + 1`,
        [studentId],
        (insertError) => {
            if (insertError) {
                return callback(insertError);
            }

            connection.query(
                `UPDATE student_violation_state
                 SET permanently_violating = 1
                 WHERE student_id = ? AND indication_count >= 5`,
                [studentId],
                (updateError) => {
                    if (updateError) {
                        return callback(updateError);
                    }

                    connection.query(
                        `SELECT permanently_violating
                         FROM student_violation_state
                         WHERE student_id = ?`,
                        [studentId],
                        (selectError, rows) => {
                            if (selectError) {
                                return callback(selectError);
                            }
                            callback(null, Boolean(rows[0]?.permanently_violating));
                        }
                    );
                }
            );
        }
    );
}

function emitDetection(req, objectNumber, status, reason, eventId) {
    req.app.get("io").emit("detection:new", {
        object: objectNumber,
        status,
        reason,
        event_id: eventId
    });
}

function commitDetectionLog(connection, result, studentId, objectNumber, eventId, activity, status, req, res, violationLogged) {
    connection.commit((error) => {
        if (error) {
            return rollbackDetection(
                connection,
                res,
                "Gagal menyimpan transaksi deteksi:",
                error
            );
        }

        connection.release();
        activeLogIds.set(eventId, {
            id: result.insertId,
            studentId,
            objectNumber,
            effectiveStatus: status
        });
        emitDetection(req, objectNumber, status, activity, eventId);
        req.app.get("io").emit("monitoring:new", {
            id: result.insertId,
            student_id: studentId,
            activity,
            status
        });
        if (violationLogged) {
            req.app.get("io").emit("violation:new", {
                student_id: studentId,
                type: activity
            });
        }
        res.status(201).json({
            message: "Deteksi tersimpan ke database",
            id: result.insertId
        });
    });
}

function rollbackDetection(connection, res, message, error) {
    connection.rollback(() => {
        connection.release();
        console.error(message, error);
        if (!res.headersSent) {
            res.status(500).json({
                message: "Gagal menyimpan deteksi ke database"
            });
        }
    });
}

function updateMonitoringLog(activeLog, activity, status, eventId, req, res) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            console.error("Gagal mendapatkan koneksi database untuk pembaruan deteksi:", connectionError);
            return res.status(500).json({
                message: "Gagal memperbarui log deteksi"
            });
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                console.error("Gagal memulai transaksi pembaruan deteksi:", transactionError);
                return res.status(500).json({
                    message: "Gagal memperbarui log deteksi"
                });
            }

            const logStatus = activeLog.effectiveStatus;
            connection.query(
                `UPDATE monitoring_logs
                 SET activity = ?, status = ?
                 WHERE id = ?`,
                [activity, logStatus, activeLog.id],
                (updateError) => {
                    if (updateError) {
                        return rollbackDetection(
                            connection,
                            res,
                            "Error memperbarui log deteksi:",
                            updateError
                        );
                    }

                    commitUpdatedDetection(
                        connection,
                        activeLog,
                        activity,
                        status,
                        logStatus,
                        eventId,
                        req,
                        res
                    );
                }
            );
        });
    });
}

function commitUpdatedDetection(connection, activeLog, activity, status, logStatus, eventId, req, res) {
    connection.commit((error) => {
        if (error) {
            return rollbackDetection(
                connection,
                res,
                "Gagal menyimpan pembaruan deteksi:",
                error
            );
        }
        connection.release();
        connection.release();
        if (status === "safe") {
            activeLogIds.delete(eventId);
        }

        req.app.get("io").emit("monitoring:updated", {
            id: activeLog.id,
            student_id: activeLog.studentId,
            activity,
            status: logStatus
        });
        const detectionStatus = status === "safe" ? "safe" : logStatus;
        emitDetection(req, activeLog.objectNumber, detectionStatus, activity, eventId);
        res.json({
            message: "Log deteksi diperbarui",
            id: activeLog.id
        });
    });
}

module.exports = router;
