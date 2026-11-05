const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./config/db");

const studentRoutes = require("./routes/students");
const monitoringRoutes = require("./routes/monitoring");
const violationRoutes = require("./routes/violations");
const detectionRoutes = require("./routes/detection");
const dashboardRoutes = require("./routes/dashboard");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});
app.set("io", io);

app.use(cors());
app.use(express.json());

// TEST BACKEND

app.get("/", (req, res) => {
    res.send("ExamGuard Backend berjalan!");
});

// API ROUTES

app.use("/api/students", studentRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/violations", violationRoutes);
app.use("/api/detection", detectionRoutes);
app.use("/api/dashboard", dashboardRoutes);

// SOCKET.IO

io.on("connection", (socket) => {

    console.log("Client terhubung:", socket.id);

    socket.on("disconnect", () => {
        console.log("Client terputus:", socket.id);
    });

});

// DATABASE CHECK AND REQUIRED TABLES

db.query(
    `CREATE TABLE IF NOT EXISTS student_violation_state (
        student_id INT UNSIGNED NOT NULL,
        indication_count INT UNSIGNED NOT NULL DEFAULT 0,
        permanently_violating TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (student_id),
        CONSTRAINT fk_student_violation_state_student
            FOREIGN KEY (student_id) REFERENCES students (id)
    ) ENGINE=InnoDB`,
    (err) => {
        if (err) {
            console.error("Gagal menyiapkan tabel status pelanggaran siswa:", err.message);
            return;
        }

        console.log("Database MySQL terhubung!");
        server.listen(3000, "0.0.0.0", () => {
            console.log("Server berjalan di http://localhost:3000");
        });
    }
);