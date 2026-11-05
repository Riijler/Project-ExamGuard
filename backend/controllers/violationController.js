const db = require("../config/db");

const getViolations = (req, res) => {
    const sql = `
        SELECT
            violations.id,
            students.student_number,
            students.name,
            violations.type,
            violations.detected_at
        FROM violations
        JOIN students
            ON violations.student_id = students.id
        ORDER BY violations.detected_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error mengambil violations:", err);

            return res.status(500).json({
                message: "Gagal mengambil data pelanggaran"
            });
        }

        res.json(results);
    });
};


const createViolation = (req, res) => {
    const { student_id, type } = req.body;
    const studentId = Number(student_id);
    const normalizedType = typeof type === "string" ? type.trim() : "";

    if (!Number.isInteger(studentId) || studentId < 1 ||
        !normalizedType || normalizedType.length > 255) {
        return res.status(400).json({
            message: "student_id dan type tidak valid"
        });
    }

    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            console.error("Gagal mendapatkan koneksi database untuk pelanggaran:", connectionError);
            return res.status(500).json({
                message: "Gagal menyimpan data pelanggaran"
            });
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                console.error("Gagal memulai transaksi pelanggaran:", transactionError);
                return res.status(500).json({
                    message: "Gagal menyimpan data pelanggaran"
                });
            }

            connection.query(
                "INSERT INTO violations (student_id, type) VALUES (?, ?)",
                [studentId, normalizedType],
                (violationError, result) => {
                    if (violationError) {
                        return rollbackViolation(connection, res, violationError);
                    }

                    connection.query(
                        `INSERT INTO monitoring_logs (student_id, activity, status)
                         VALUES (?, ?, 'violation')`,
                        [studentId, normalizedType],
                        (monitoringError) => {
                            if (monitoringError) {
                                return rollbackViolation(connection, res, monitoringError);
                            }

                            connection.commit((commitError) => {
                                if (commitError) {
                                    return rollbackViolation(connection, res, commitError);
                                }
                                connection.release();

                                const io = req.app.get("io");
                                io.emit("violation:new", {
                                    id: result.insertId,
                                    student_id: studentId,
                                    type: normalizedType
                                });
                                io.emit("monitoring:new", {
                                    student_id: studentId,
                                    activity: normalizedType,
                                    status: "violation"
                                });

                                res.status(201).json({
                                    message: "Pelanggaran dan log aktivitas tersimpan",
                                    id: result.insertId
                                });
                            });
                        }
                    );
                }
            );
        });
    });
};

function rollbackViolation(connection, res, error) {
    connection.rollback(() => {
        connection.release();
        console.error("Gagal menyimpan pelanggaran dan log monitoring:", error);
        if (!res.headersSent) {
            res.status(500).json({
                message: "Gagal menyimpan data pelanggaran"
            });
        }
    });
}

module.exports = {
    getViolations,
    createViolation
};