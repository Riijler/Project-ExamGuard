const express = require("express");
const router = express.Router();

const {
    getViolations,
    createViolation
} = require("../controllers/violationController");

router.get("/", getViolations);
router.post("/", createViolation);

module.exports = router;