const db = require("../config/db");

const getAllStudents = (req, res) => {
    const sql = "SELECT * FROM students";

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error mengambil data siswa:", err);
            return res.status(500).json({
                message: "Gagal mengambil data siswa"
            });
        }

        res.json(results);
    });
};

module.exports = {
    getAllStudents
};