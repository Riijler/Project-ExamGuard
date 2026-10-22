const express = require("express");
const db = require("../config/db");

const router = express.Router();
const studentMappings = new Map();
const activeLogIds = new Map();
const allowedStatuses = new Set(["safe", "warning", "violation"]);

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
        if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 5) {
            return res.status(400).json({
                message: "Nomor slot harus berada di antara 1 sampai 5"
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

    studentMappings.clear();
    for (const [slot, studentId] of nextMappings) {
        studentMappings.set(slot, studentId);
    }

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

    const detection = {
        object: objectNumber,
        status,
        reason: normalizedReason,
        event_id: eventId
    };
    req.app.get("io").emit("detection:new", detection);

    const studentId = studentMappings.get(String(objectNumber));
    if (!studentId) {
        return res.status(202).json({
            message: "Deteksi diterima, tetapi slot belum dipetakan ke siswa"
        });
    }

    const activeLog = activeLogIds.get(eventId);
    if (activeLog) {
        return updateMonitoringLog(
            activeLog.id,
            activeLog.studentId,
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

    const sql = `
        INSERT INTO monitoring_logs (student_id, activity, status)
        VALUES (?, ?, ?)
    `;
    db.query(sql, [studentId, normalizedReason, status], (err, result) => {
        if (err) {
            console.error("Error menyimpan deteksi ke log aktivitas:", err);
            return res.status(500).json({
                message: "Gagal menyimpan deteksi ke log aktivitas"
            });
        }

        activeLogIds.set(eventId, {
            id: result.insertId,
            studentId
        });
        req.app.get("io").emit("monitoring:new", {
            id: result.insertId,
            student_id: studentId,
            activity: normalizedReason,
            status
        });

        res.status(201).json({
            message: "Deteksi tersimpan ke log aktivitas",
            id: result.insertId
        });
    });
});

function updateMonitoringLog(logId, studentId, activity, status, eventId, req, res) {
    const sql = `
        UPDATE monitoring_logs
        SET student_id = ?, activity = ?, status = ?
        WHERE id = ?
    `;
    db.query(sql, [studentId, activity, status, logId], (err) => {
        if (err) {
            console.error("Error memperbarui log deteksi:", err);
            return res.status(500).json({
                message: "Gagal memperbarui log deteksi"
            });
        }

        if (status === "safe") {
            activeLogIds.delete(eventId);
        }

        req.app.get("io").emit("monitoring:updated", {
            id: logId,
            student_id: studentId,
            activity,
            status
        });
        res.json({ message: "Log deteksi diperbarui", id: logId });
    });
}

module.exports = router;
