const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./config/db");

const studentRoutes = require("./routes/students");
const monitoringRoutes = require("./routes/monitoring");
const violationRoutes = require("./routes/violations");
const detectionRoutes = require("./routes/detection");

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

// SOCKET.IO

io.on("connection", (socket) => {

    console.log("Client terhubung:", socket.id);

    socket.on("disconnect", () => {
        console.log("Client terputus:", socket.id);
    });

});

// DATABASE CHECK

db.query("SELECT 1", (err) => {

    if (err) {
        console.error("Database gagal terhubung:", err.message);
        return;
    }

    console.log("Database MySQL terhubung!");

});

// START SERVER

server.listen(3000, "0.0.0.0", () => {

    console.log("Server berjalan di http://localhost:3000");

});