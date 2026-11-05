const express = require("express");
const router = express.Router();

const {
    getMonitoringLogs,
    createMonitoringLog,
    updateMonitoringLog,
    deleteMonitoringLog
} = require("../controllers/monitoringController");

router.get("/", getMonitoringLogs);
router.post("/", createMonitoringLog);
router.put("/:id", updateMonitoringLog);
router.delete("/:id", deleteMonitoringLog);


module.exports = router;