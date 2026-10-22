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

    if (!student_id || !type) {
        return res.status(400).json({
            message: "student_id dan type wajib diisi"
        });
    }

    const sql = `
        INSERT INTO violations
        (student_id, type)
        VALUES (?, ?)
    `;

    db.query(
        sql,
        [student_id, type],
        (err, result) => {
            if (err) {
                console.error("Error menyimpan violation:", err);

                return res.status(500).json({
                    message: "Gagal menyimpan data pelanggaran"
                });
            }

            // Simpan juga ke monitoring_logs
            const monitoringSql = `
                INSERT INTO monitoring_logs
                (student_id, activity, status)
                VALUES (?, ?, ?)
            `;

            db.query(
                monitoringSql,
                [student_id, type, "violation"],
                (monitoringErr) => {
                    if (monitoringErr) {
                        console.error(
                            "Gagal menyimpan monitoring log:",
                            monitoringErr
                        );
                    }

                    const io = req.app.get("io");

                    // Kirim event pelanggaran
                    io.emit("violation:new", {
                        id: result.insertId,
                        student_id,
                        type
                    });

                    // Kirim event monitoring
                    io.emit("monitoring:new", {
                        student_id,
                        activity: type,
                        status: "violation"
                    });

                    res.status(201).json({
                        message: "Data pelanggaran berhasil disimpan",
                        id: result.insertId
                    });
                }
            );
        }
    );
};

module.exports = {
    getViolations,
    createViolation
};