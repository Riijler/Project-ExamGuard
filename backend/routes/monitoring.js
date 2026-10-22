const express = require("express");
const router = express.Router();

const {
    getMonitoringLogs,
    createMonitoringLog,
    updateMonitoringLog
} = require("../controllers/monitoringController");

router.get("/", getMonitoringLogs);
router.post("/", createMonitoringLog);
router.put("/:id", updateMonitoringLog);


module.exports = router;