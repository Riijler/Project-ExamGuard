const db = require("../config/db");

const getMonitoringLogs = (req, res) => {
    const sql = `
        SELECT 
            monitoring_logs.id,
            monitoring_logs.student_id,
            students.student_number,
            students.name,
            monitoring_logs.activity,
            monitoring_logs.status,
            monitoring_logs.detected_at
        FROM monitoring_logs
        JOIN students 
            ON monitoring_logs.student_id = students.id
        ORDER BY monitoring_logs.detected_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error mengambil monitoring logs:", err);

            return res.status(500).json({
                message: "Gagal mengambil data monitoring"
            });
        }

        res.json(results);
    });
};


const createMonitoringLog = (req, res) => {
    const {
        student_id,
        activity,
        status
    } = req.body;

    if (!student_id || !activity || !status) {
        return res.status(400).json({
            message: "student_id, activity, dan status wajib diisi"
        });
    }

    const sql = `
        INSERT INTO monitoring_logs
        (student_id, activity, status)
        VALUES (?, ?, ?)
    `;

    db.query(
        sql,
        [student_id, activity, status],
        (err, result) => {
            if (err) {
                console.error("Error menyimpan monitoring:", err);

                return res.status(500).json({
                    message: "Gagal menyimpan data monitoring"
                });
            }

            const io = req.app.get("io");

            io.emit("monitoring:new", {
                id: result.insertId,
                student_id,
                activity,
                status
            });

            res.status(201).json({
                message: "Data monitoring berhasil disimpan",
                id: result.insertId
            });
        }
    );
};

const updateMonitoringLog = (req, res) => {
    const logId = Number(req.params.id);
    const { student_id, activity, status } = req.body;
    const studentId = Number(student_id);
    const allowedStatuses = ["safe", "warning", "violation"];
    const normalizedActivity = typeof activity === "string" ? activity.trim() : "";

    if (!Number.isInteger(logId) || logId < 1 ||
        !Number.isInteger(studentId) || studentId < 1 ||
        !normalizedActivity || normalizedActivity.length > 255 ||
        !allowedStatuses.includes(status)) {
        return res.status(400).json({
            message: "Siswa, aktivitas, atau status log tidak valid"
        });
    }

    const sql = `
        UPDATE monitoring_logs
        SET student_id = ?, activity = ?, status = ?
        WHERE id = ?
    `;

    db.query(sql, [studentId, normalizedActivity, status, logId], (err, result) => {
        if (err) {
            console.error("Error mengubah monitoring log:", err);
            return res.status(500).json({
                message: "Gagal mengubah log aktivitas"
            });
        }

        if (result.affectedRows === 0) {
            return db.query(
                "SELECT id FROM monitoring_logs WHERE id = ?",
                [logId],
                (lookupErr, rows) => {
                    if (lookupErr) {
                        console.error("Error memeriksa monitoring log:", lookupErr);
                        return res.status(500).json({
                            message: "Gagal memeriksa log aktivitas"
                        });
                    }

                    if (rows.length === 0) {
                        return res.status(404).json({
                            message: "Log aktivitas tidak ditemukan"
                        });
                    }

                    emitUpdatedLog();
                }
            );
        }

        emitUpdatedLog();
    });

    function emitUpdatedLog() {
        const selectSql = `
            SELECT
                monitoring_logs.id,
                students.student_number,
                students.name,
                monitoring_logs.student_id,
                monitoring_logs.activity,
                monitoring_logs.status,
                monitoring_logs.detected_at
            FROM monitoring_logs
            JOIN students ON monitoring_logs.student_id = students.id
            WHERE monitoring_logs.id = ?
        `;

        db.query(selectSql, [logId], (err, rows) => {
            if (err) {
                console.error("Error mengambil log yang diperbarui:", err);
                return res.status(500).json({
                    message: "Log berubah tetapi gagal memuat hasilnya"
                });
            }

            const log = rows[0];
            req.app.get("io").emit("monitoring:updated", log);
            res.json({
                message: "Log aktivitas berhasil diperbarui",
                log
            });
        });
    }
};


module.exports = {
    getMonitoringLogs,
    createMonitoringLog,
    updateMonitoringLog
};