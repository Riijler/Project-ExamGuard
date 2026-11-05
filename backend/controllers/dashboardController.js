const db = require("../config/db");
const { getMappedStudentCount } = require("../studentMappings");

const getDashboardSummary = (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM students) AS total_students,
            (
                SELECT COUNT(*)
                FROM monitoring_logs
                WHERE status = 'violation'
                    AND detected_at >= CURDATE()
                    AND detected_at < CURDATE() + INTERVAL 1 DAY
            ) AS total_violations
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error mengambil ringkasan dashboard:", err);
            return res.status(500).json({
                message: "Gagal mengambil ringkasan dashboard"
            });
        }

        const summary = results[0];
        res.json({
            total_students: Number(summary.total_students),
            total_violations: Number(summary.total_violations),
            connected_devices: getMappedStudentCount()
        });
    });
};

module.exports = {
    getDashboardSummary
};
