console.log("Dashboard JS Loaded");

const socket = io("http://localhost:3000");
const liveDetectionRows = new Map();
let studentRoster = [];

function getLiveLogOverrides() {
    try {
        return JSON.parse(localStorage.getItem("examguard-live-log-edits") || "{}");
    } catch (error) {
        console.error("Perubahan log live tersimpan tidak valid:", error);
        return {};
    }
}

function formatActivityText(activity) {
    const value = String(activity || "");
    if (/MENGHILANG_DARI_KAMERA|WAJAH HILANG/i.test(value)) {
        return "Siswa mencoba menghilang dari kamera";
    }
    if (/MENOLEH/i.test(value)) {
        return "Siswa mencoba menoleh";
    }
    if (/MENUNDUK/i.test(value)) {
        return "Siswa mencoba menunduk";
    }
    return value;
}

socket.on("connect", () => {
    console.log("Terhubung ke Socket.IO:", socket.id);

    document.getElementById("status-title").textContent =
        "Sistem Terhubung";

    document.getElementById("status-description").textContent =
        "Semua perangkat aktif";

    document.getElementById("status-dot").classList.add("connected");
});

socket.on("detection:new", (data) => {
    console.log("Deteksi baru:", data);
    addDetectionToActivityLog(data);
});

function addDetectionToActivityLog(data) {
    const activityLog = document.getElementById("activity-log");
    const objectNumber = Number(data.object);
    const eventKey = data.event_id || `student-${objectNumber}`;
    if (!activityLog || !Number.isInteger(objectNumber) || objectNumber < 1) {
        return;
    }

    const emptyRow = activityLog.querySelector(".empty-activity-row");
    if (emptyRow) {
        emptyRow.remove();
    }

    let row = liveDetectionRows.get(eventKey);
    if (!row) {
        row = document.createElement("tr");
        row.className = "live-detection-row";
        row.dataset.eventKey = eventKey;
        row.dataset.object = String(objectNumber);
        row.dataset.detectedAt = new Date().toISOString();
        const timeCell = document.createElement("td");
        timeCell.textContent = new Date(row.dataset.detectedAt).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        const studentCell = document.createElement("td");
        studentCell.textContent = `Siswa ${objectNumber}`;
        const activityCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const actionCell = document.createElement("td");
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-log-button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => openEditLog({
            isLive: true,
            eventKey,
            object: objectNumber,
            activity: row.dataset.activity,
            status: row.dataset.status,
            student_id: row.dataset.studentId,
            studentLabel: row.cells[1].textContent
        }));
        actionCell.appendChild(editButton);
        const mappingSelect = document.getElementById(`student-mapping-${objectNumber}`);
        if (mappingSelect?.value) {
            row.dataset.studentId = mappingSelect.value;
            const student = studentRoster.find((item) =>
                String(item.id) === String(mappingSelect.value)
            );
            if (student) {
                studentCell.textContent = `${student.student_number} - ${student.name}`;
            }
        }
        row.append(timeCell, studentCell, activityCell, statusCell, actionCell);
        activityLog.prepend(row);
        liveDetectionRows.set(eventKey, row);
    }

    const overrides = getLiveLogOverrides();
    const override = overrides[eventKey];
    const reason = String(override?.activity || data.reason || "Aktivitas terdeteksi");
    const status = override?.status || data.status;
    row.dataset.activity = reason;
    row.dataset.status = status;
    if (override?.studentId) {
        row.dataset.studentId = String(override.studentId);
        const student = studentRoster.find((item) =>
            String(item.id) === String(override.studentId)
        );
        row.cells[1].textContent = student
            ? `${student.student_number} - ${student.name}`
            : override.studentLabel || `Siswa ${objectNumber}`;
    } else if (override?.studentLabel) {
        row.cells[1].textContent = override.studentLabel;
    }
    const displayActivity = formatActivityText(reason);
    row.cells[2].textContent = displayActivity;

    const statusLabels = {
        warning: ["Peringatan", "warning"],
        violation: ["Pelanggaran", "danger"],
        safe: ["Aman", "success"]
    };
    const [label, className] = statusLabels[status] || ["Terdeteksi", "warning"];
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = label;
    row.cells[3].replaceChildren(badge);
}

socket.on("disconnect", () => {
    console.log("Socket.IO terputus");

    document.getElementById("status-title").textContent =
        "Sistem Terputus";

    document.getElementById("status-description").textContent =
        "Koneksi ke server terputus";

    document.getElementById("status-dot").classList.remove("connected");
});

socket.on("monitoring:new", (data) => {
    console.log("Monitoring baru:", data);

    loadMonitoringLogs();

    if (data.status === "violation") {
        loadTotalViolations();
    }
});

socket.on("monitoring:updated", (data) => {
    console.log("Log aktivitas diperbarui:", data);
    loadMonitoringLogs();
});

socket.on("violation:new", (data) => {
    console.log("Pelanggaran baru:", data);

    loadTotalViolations();
    loadMonitoringLogs();
});

function updateDateTime() {

    const now = new Date();

    const timeElement = document.getElementById("current-time");

    if (!timeElement) {
        return;
    }

    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    timeElement.textContent =
        `${hours}:${minutes}:${seconds} WIB`;
}


// Jalankan langsung saat halaman dibuka
updateDateTime();


// Update setiap 1 detik
setInterval(updateDateTime, 1000);

async function loadTotalStudents() {
    try {
        const response = await fetch("http://localhost:3000/api/students");
        const students = await response.json();

        document.getElementById("total-students").textContent = students.length;

    } catch (error) {
        console.error("Gagal mengambil data siswa:", error);
    }
}

loadTotalStudents();

let mappingsDirty = false;

function renderStudentSelect(select, selectedValue, includeEmpty = false) {
    select.replaceChildren();
    if (includeEmpty) {
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "Pilih siswa";
        select.appendChild(emptyOption);
    }

    studentRoster.forEach((student) => {
        const option = document.createElement("option");
        option.value = student.id;
        option.textContent = `${student.student_number} - ${student.name}`;
        select.appendChild(option);
    });

    if (selectedValue !== undefined && selectedValue !== null) {
        select.value = String(selectedValue);
    }
}

function renderStudentMappings() {
    const grid = document.getElementById("student-mapping-grid");
    if (!grid) {
        return;
    }

    let savedMappings = {};
    try {
        savedMappings = JSON.parse(localStorage.getItem("examguard-student-mappings") || "{}");
    } catch (error) {
        console.error("Pemetaan siswa tersimpan tidak valid:", error);
    }

    grid.replaceChildren();
    for (let slot = 1; slot <= 5; slot += 1) {
        const row = document.createElement("label");
        row.className = "student-mapping-row";
        row.htmlFor = `student-mapping-${slot}`;

        const slotLabel = document.createElement("strong");
        slotLabel.textContent = `Slot ${slot}`;

        const select = document.createElement("select");
        select.id = `student-mapping-${slot}`;
        select.dataset.slot = String(slot);
        renderStudentSelect(select, savedMappings[slot], true);
        select.addEventListener("change", saveStudentMappings);

        row.append(slotLabel, select);
        grid.appendChild(row);
    }
}

function getCameraStudentLabels() {
    const labels = {};
    document.querySelectorAll(".student-mapping-row select").forEach((select) => {
        const student = studentRoster.find((item) =>
            String(item.id) === String(select.value)
        );
        labels[select.dataset.slot] = student ? student.name : "";
    });
    return labels;
}

let lastCameraStudentLabels = "";

async function syncCameraStudentLabels(labels = getCameraStudentLabels()) {
    const serializedLabels = JSON.stringify(labels);
    if (serializedLabels === lastCameraStudentLabels) {
        return;
    }

    try {
        const response = await fetch("http://127.0.0.1:5000/control/student-mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mappings: labels })
        });
        if (!response.ok) {
            throw new Error(`Kamera menolak label siswa (${response.status})`);
        }
        lastCameraStudentLabels = serializedLabels;
    } catch (error) {
        console.error("Gagal mengirim label siswa ke kamera:", error);
    }
}

async function saveStudentMappings() {
    const mappings = {};
    document.querySelectorAll(".student-mapping-row select").forEach((select) => {
        mappings[select.dataset.slot] = select.value || null;
    });

    localStorage.setItem("examguard-student-mappings", JSON.stringify(mappings));
    mappingsDirty = true;
    await syncCameraStudentLabels();
    await syncStudentMappings();
}

async function syncStudentMappings() {
    if (!mappingsDirty) {
        return;
    }

    const status = document.getElementById("student-mapping-status");
    const mappings = {};
    document.querySelectorAll(".student-mapping-row select").forEach((select) => {
        mappings[select.dataset.slot] = select.value || null;
    });
    const mappedSlots = Object.values(mappings).filter(Boolean).length;

    try {
        const response = await fetch("http://localhost:3000/api/detection/mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mappings })
        });
        if (!response.ok) {
            throw new Error(`Server menolak pemetaan (${response.status})`);
        }
        mappingsDirty = false;
        if (status) {
            status.textContent = mappedSlots
                ? `${mappedSlots} slot siswa tersimpan.`
                : "Belum ada slot yang dipetakan; deteksi tidak akan masuk log.";
        }
    } catch (error) {
        console.error("Gagal menyimpan pemetaan slot kamera:", error);
        if (status) {
            status.textContent = "Belum tersambung ke backend; pemetaan tersimpan di browser.";
        }
    }
}

async function loadStudents() {
    try {
        const response = await fetch("http://localhost:3000/api/students");
        if (!response.ok) {
            throw new Error(`Gagal memuat daftar siswa (${response.status})`);
        }

        studentRoster = await response.json();
        renderStudentMappings();
        const editStudent = document.getElementById("edit-log-student");
        if (editStudent) {
            renderStudentSelect(editStudent);
        }
        mappingsDirty = true;
        await syncStudentMappings();
    } catch (error) {
        console.error("Gagal memuat daftar siswa:", error);
        document.getElementById("student-mapping-status").textContent =
            "Gagal memuat siswa. Periksa koneksi backend.";
    }
}

async function loadTotalViolations() {
    try {
        const response = await fetch("http://localhost:3000/api/violations");
        const violations = await response.json();

        document.getElementById("total-violations").textContent = violations.length;

    } catch (error) {
        console.error("Gagal mengambil data pelanggaran:", error);
    }
}

loadTotalViolations();

async function loadMonitoringLogs() {
    try {
        const response = await fetch("http://localhost:3000/api/monitoring");
        const logs = await response.json();

        const activityLog = document.getElementById("activity-log");

        activityLog.innerHTML = "";

        logs.forEach(log => {
            const row = document.createElement("tr");
            row.dataset.logId = String(log.id);
            row.dataset.studentId = String(log.student_id);

            const detectedTime = new Date(log.detected_at);

            const time = detectedTime.toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit"
            });

            let statusText = "";
            let statusClass = "";

            if (log.status === "violation") {
                statusText = "Pelanggaran";
                statusClass = "danger";
            } else if (log.status === "warning") {
                statusText = "Peringatan";
                statusClass = "warning";
            } else {
                statusText = "Aman";
                statusClass = "success";
            }

            const timeCell = document.createElement("td");
            timeCell.textContent = time;
            const studentCell = document.createElement("td");
            studentCell.textContent = `${log.student_number} - ${log.name}`;
            const activityCell = document.createElement("td");
            activityCell.textContent = formatActivityText(log.activity);
            const statusCell = document.createElement("td");
            const statusBadge = document.createElement("span");
            statusBadge.className = statusClass;
            statusBadge.textContent = statusText;
            statusCell.appendChild(statusBadge);
            const actionCell = document.createElement("td");
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "edit-log-button";
            editButton.textContent = "Edit";
            editButton.setAttribute("aria-label", `Edit log ${log.id}`);
            editButton.addEventListener("click", () => openEditLog(log));
            actionCell.appendChild(editButton);
            row.append(timeCell, studentCell, activityCell, statusCell, actionCell);

            for (const [eventKey, liveRow] of liveDetectionRows) {
                if (liveRow.dataset.studentId === String(log.student_id) &&
                    liveRow.dataset.activity === log.activity) {
                    liveDetectionRows.set(eventKey, row);
                    liveRow.remove();
                    break;
                }
            }
            activityLog.appendChild(row);
        });

        for (const liveRow of liveDetectionRows.values()) {
            if (!liveRow.isConnected) {
                activityLog.appendChild(liveRow);
            }
        }

        if (activityLog.children.length === 0) {
            activityLog.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-activity-row" style="text-align:center;">
                        Belum ada aktivitas
                    </td>
                </tr>
            `;
        }

    } catch (error) {
        console.error("Gagal mengambil data monitoring:", error);
    }
}

loadMonitoringLogs();
loadStudents();
setInterval(syncStudentMappings, 5000);

const editLogDialog = document.getElementById("edit-log-dialog");
const editLogForm = document.getElementById("edit-log-form");
const allActivityDialog = document.getElementById("all-activity-dialog");

function appendAllActivityRow(tbody, log) {
    const row = document.createElement("tr");
    const time = new Date(log.detected_at || Date.now()).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
    const statusLabels = {
        violation: ["Pelanggaran", "danger"],
        warning: ["Peringatan", "warning"],
        safe: ["Aman", "success"]
    };
    const [statusText, statusClass] = statusLabels[log.status] || ["Terdeteksi", "warning"];

    const timeCell = document.createElement("td");
    timeCell.textContent = time;
    const studentCell = document.createElement("td");
    studentCell.textContent = log.name
        ? `${log.student_number} - ${log.name}`
        : `Siswa ${log.object}`;
    const activityCell = document.createElement("td");
    activityCell.textContent = log.displayActivity || formatActivityText(log.activity);
    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = statusClass;
    statusBadge.textContent = statusText;
    statusCell.appendChild(statusBadge);
    const actionCell = document.createElement("td");

    if ((log.id && log.student_id) || log.isLive) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-log-button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => openEditLog(log));
        actionCell.appendChild(editButton);
    } else {
        actionCell.textContent = "-";
    }

    row.append(timeCell, studentCell, activityCell, statusCell, actionCell);
    tbody.appendChild(row);
}

async function showAllActivities() {
    const tbody = document.getElementById("all-activity-log");
    const message = document.getElementById("all-activity-message");
    tbody.replaceChildren();
    message.textContent = "Memuat semua log...";
    allActivityDialog.showModal();

    try {
        const response = await fetch("http://localhost:3000/api/monitoring");
        if (!response.ok) {
            throw new Error(`Backend tidak dapat memuat log (${response.status})`);
        }

        const logs = await response.json();
        logs.forEach((log) => appendAllActivityRow(tbody, log));

        const knownLogKeys = new Set(logs.map((log) =>
            `${log.student_id}:${log.activity}`
        ));
        let liveCount = 0;
        for (const liveRow of new Set(liveDetectionRows.values())) {
            if (!liveRow.classList.contains("live-detection-row")) {
                continue;
            }
            const mappedStudentId = liveRow.dataset.studentId || "";
            const activity = liveRow.dataset.activity || liveRow.cells[2].textContent;
            const logKey = `${mappedStudentId}:${activity}`;
            if (mappedStudentId && knownLogKeys.has(logKey)) {
                continue;
            }
            appendAllActivityRow(tbody, {
                object: liveRow.cells[1].textContent.replace("Siswa ", ""),
                detected_at: liveRow.dataset.detectedAt,
                displayActivity: liveRow.cells[2].textContent,
                status: liveRow.dataset.status || "warning",
                isLive: true,
                eventKey: liveRow.dataset.eventKey,
                activity: liveRow.dataset.activity,
                student_id: liveRow.dataset.studentId,
                studentLabel: liveRow.cells[1].textContent
            });
            liveCount += 1;
        }

        if (logs.length === 0 && liveCount === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 5;
            cell.textContent = "Belum ada aktivitas.";
            row.appendChild(cell);
            tbody.appendChild(row);
        }
        message.textContent = liveCount
            ? `${logs.length} log tersimpan, ${liveCount} aktivitas live.`
            : `${logs.length} log aktivitas.`;
    } catch (error) {
        console.error("Gagal memuat semua log aktivitas:", error);
        let liveCount = 0;
        for (const liveRow of new Set(liveDetectionRows.values())) {
            if (liveRow.classList.contains("live-detection-row")) {
                appendAllActivityRow(tbody, {
                    object: liveRow.cells[1].textContent.replace("Siswa ", ""),
                    detected_at: liveRow.dataset.detectedAt,
                    displayActivity: liveRow.cells[2].textContent,
                    status: liveRow.dataset.status || "warning",
                    isLive: true,
                    eventKey: liveRow.dataset.eventKey,
                    activity: liveRow.dataset.activity,
                    student_id: liveRow.dataset.studentId,
                    studentLabel: liveRow.cells[1].textContent
                });
                liveCount += 1;
            }
        }
        message.textContent = liveCount
            ? `Backend belum tersedia; menampilkan ${liveCount} aktivitas live saja.`
            : "Log aktivitas belum dapat dimuat. Pastikan backend sudah berjalan.";
    }
}

document.getElementById("view-all-activity")?.addEventListener("click", showAllActivities);
document.getElementById("close-all-activity")?.addEventListener("click", () => {
    allActivityDialog.close();
});

function openEditLog(log) {
    editLogForm.dataset.logId = log.id ? String(log.id) : "";
    editLogForm.dataset.liveEventKey = log.isLive ? log.eventKey : "";
    const studentSelect = document.getElementById("edit-log-student");
    renderStudentSelect(studentSelect, log.student_id, Boolean(log.isLive));
    const hasStudentOption = studentRoster.some((student) =>
        String(student.id) === String(log.student_id)
    );
    if (log.isLive && (!log.student_id || !hasStudentOption)) {
        const slotOption = document.createElement("option");
        slotOption.value = `slot:${log.object}`;
        slotOption.textContent = log.studentLabel || `Siswa ${log.object}`;
        studentSelect.appendChild(slotOption);
        studentSelect.value = slotOption.value;
    }
    document.getElementById("edit-log-activity").value = log.activity;
    document.getElementById("edit-log-status").value = log.status;
    editLogDialog.showModal();
}

document.getElementById("cancel-edit-log")?.addEventListener("click", () => {
    editLogDialog.close();
});

editLogForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const logId = editLogForm.dataset.logId;
    const liveEventKey = editLogForm.dataset.liveEventKey;
    const studentSelect = document.getElementById("edit-log-student");
    const payload = {
        student_id: studentSelect.value,
        activity: document.getElementById("edit-log-activity").value,
        status: document.getElementById("edit-log-status").value
    };

    if (liveEventKey) {
        const row = liveDetectionRows.get(liveEventKey);
        if (!row) {
            window.alert("Log live ini sudah tidak tersedia.");
            return;
        }
        const overrides = getLiveLogOverrides();
        const selectedOption = studentSelect.selectedOptions[0];
        overrides[liveEventKey] = {
            studentId: payload.student_id.startsWith("slot:")
                ? ""
                : payload.student_id,
            studentLabel: payload.student_id.startsWith("slot:")
                ? selectedOption.textContent
                : selectedOption.textContent,
            activity: payload.activity.trim(),
            status: payload.status
        };
        localStorage.setItem("examguard-live-log-edits", JSON.stringify(overrides));
        editLogDialog.close();
        addDetectionToActivityLog({
            object: row.dataset.object,
            event_id: liveEventKey,
            reason: payload.activity.trim(),
            status: payload.status
        });
        if (allActivityDialog.open) {
            allActivityDialog.close();
            showAllActivities();
        }
        return;
    }

    try {
        const response = await fetch(`http://localhost:3000/api/monitoring/${logId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || `Gagal menyimpan log (${response.status})`);
        }
        editLogDialog.close();
        await loadMonitoringLogs();
    } catch (error) {
        console.error("Gagal menyimpan perubahan log:", error);
        window.alert(error.message);
    }
});

const cameraStream = document.getElementById("camera-stream");
const cameraMessage = document.getElementById("camera-message");
const cameraStatusText = document.getElementById("camera-status-text");
const streamUrl = "http://127.0.0.1:5000/frame.jpg";
const cameraApiUrl = "http://127.0.0.1:5000";
let cameraRefreshTimer;
let pythonCameraStopped = false;
let cameraStreamRequested = false;
let streamConnecting = false;
let restartPending = false;
let lastDetectionEventId = 0;
let detectionPollTimer;

function startDetectionPolling() {
    if (!detectionPollTimer) {
        pollDetectionEvents();
        detectionPollTimer = setInterval(pollDetectionEvents, 500);
    }
}

function stopDetectionPolling() {
    clearInterval(detectionPollTimer);
    detectionPollTimer = undefined;
}

async function pollDetectionEvents() {
    try {
        const response = await fetch(`${cameraApiUrl}/detections?after=${lastDetectionEventId}`);
        if (!response.ok) {
            throw new Error(`Deteksi live gagal dimuat (${response.status})`);
        }

        const result = await response.json();
        result.events.forEach((event) => {
            addDetectionToActivityLog(event);
            lastDetectionEventId = Math.max(lastDetectionEventId, event.id);
        });
        lastDetectionEventId = Math.max(lastDetectionEventId, result.latestId);
    } catch (error) {
        console.error("Gagal mengambil log deteksi dari kamera:", error);
    }
}

function startCameraStream() {
    if (!cameraStream || !cameraMessage || !cameraStatusText) {
        return;
    }

    if (pythonCameraStopped) {
        cameraMessage.textContent = "Kamera Python sudah dihentikan. Jalankan ulang ExamGuard untuk memulai kamera.";
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "OFFLINE";
        return;
    }

    cameraStreamRequested = true;
    streamConnecting = true;
    clearTimeout(cameraRefreshTimer);
    cameraMessage.textContent = "Menghubungkan ke kamera Python...";
    cameraMessage.hidden = false;
    cameraStream.hidden = true;
    cameraStatusText.textContent = "MENGHUBUNGKAN";

    const requestNextFrame = () => {
        cameraStream.src = `${streamUrl}?t=${Date.now()}`;
    };

    cameraStream.onload = () => {
        streamConnecting = false;
        cameraStream.hidden = false;
        cameraMessage.hidden = true;
        cameraStatusText.textContent = "LIVE";
        cameraRefreshTimer = setTimeout(requestNextFrame, 150);
    };

    cameraStream.onerror = () => {
        streamConnecting = false;
        cameraStream.hidden = true;
        cameraMessage.textContent =
            "Menunggu kamera Python... Pastikan detection\\tes.py sedang berjalan.";
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "OFFLINE";
        cameraRefreshTimer = setTimeout(requestNextFrame, 1000);
    };

    requestNextFrame();
}

function updateCameraControls(status) {
    const esp32StatusText = document.getElementById("esp32-status-text");
    const esp32StatusDot = document.getElementById("esp32-status-dot");
    const calibrationStatusText = document.getElementById("calibration-status-text");
    const landmarksButton = document.getElementById("toggle-landmarks");

    if (esp32StatusText) {
        esp32StatusText.textContent = status.esp32Connected
            ? "Terhubung"
            : "Tidak terhubung";
    }
    if (esp32StatusDot) {
        esp32StatusDot.className = `category-dot ${status.esp32Connected ? "success-dot" : "danger-dot"}`;
    }
    if (calibrationStatusText) {
        calibrationStatusText.textContent = status.calibrating
            ? "Sedang berjalan..."
            : status.calibrated
                ? "Selesai"
                : "Belum dilakukan";
    }
    if (landmarksButton) {
        const label = landmarksButton.querySelector("span");
        if (label) {
            label.textContent = `Landmark: ${status.landmarks ? "Aktif" : "Mati"}`;
        }
    }
    pythonCameraStopped = !status.cameraRunning;
    if (status.cameraRunning && restartPending && cameraStreamRequested && cameraStream.hidden && !streamConnecting) {
        restartPending = false;
        startCameraStream();
        startDetectionPolling();
    }
}

async function refreshCameraControls() {
    const esp32StatusText = document.getElementById("esp32-status-text");
    const calibrationStatusText = document.getElementById("calibration-status-text");
    try {
        const response = await fetch(`${cameraApiUrl}/status`);
        if (!response.ok) {
            throw new Error(`Status kamera gagal dimuat (${response.status})`);
        }
        updateCameraControls(await response.json());
        await syncCameraStudentLabels();
    } catch (error) {
        if (esp32StatusText) {
            esp32StatusText.textContent = "MediaPipe tidak terhubung";
        }
        if (calibrationStatusText) {
            calibrationStatusText.textContent = "Kamera tidak terhubung";
        }
    }
}

async function sendCameraControl(action) {
    try {
        const response = await fetch(`${cameraApiUrl}/control/${action}`, {
            method: "POST"
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Kontrol kamera gagal (${response.status})`);
        }
        updateCameraControls(result);

        if (action === "stop") {
            cameraStreamRequested = false;
            streamConnecting = false;
            stopDetectionPolling();
            clearTimeout(cameraRefreshTimer);
            cameraStream.onload = null;
            cameraStream.onerror = null;
            cameraStream.removeAttribute("src");
            cameraStream.hidden = true;
            cameraMessage.textContent = "Kamera dihentikan.";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "OFFLINE";
        } else if (action === "restart") {
            cameraStreamRequested = true;
            restartPending = true;
            lastDetectionEventId = 0;
            stopDetectionPolling();
            streamConnecting = false;
            clearTimeout(cameraRefreshTimer);
            cameraStream.onload = null;
            cameraStream.onerror = null;
            cameraStream.removeAttribute("src");
            cameraStream.hidden = true;
            cameraMessage.textContent = "Memulai ulang deteksi MediaPipe...";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "MEMULAI ULANG";
        }
    } catch (error) {
        console.error(`Gagal menjalankan kontrol kamera (${action}):`, error);
        if (action === "restart") {
            cameraMessage.textContent = "Gagal memulai ulang MediaPipe. Pastikan proses Python masih berjalan.";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "OFFLINE";
        }
        if (action === "calibrate") {
            document.getElementById("calibration-status-text").textContent =
                "Gagal mengirim perintah";
        }
    }
}

document.getElementById("activate-camera")?.addEventListener("click", startCameraStream);
document.getElementById("camera-button")?.addEventListener("click", startCameraStream);
document.getElementById("calibrate-camera")?.addEventListener("click", () => {
    sendCameraControl("calibrate");
});
document.getElementById("toggle-landmarks")?.addEventListener("click", () => {
    sendCameraControl("landmarks");
});
document.getElementById("stop-camera")?.addEventListener("click", () => {
    sendCameraControl("stop");
});
document.getElementById("restart-camera")?.addEventListener("click", () => {
    sendCameraControl("restart");
});

refreshCameraControls();
setInterval(refreshCameraControls, 2000);
startCameraStream();
startDetectionPolling();

const refreshButton = document.getElementById("refresh-dashboard");

function refreshDashboard() {
    loadTotalStudents();
    loadTotalViolations();
    loadMonitoringLogs();
    refreshCameraControls();

    if (cameraStreamRequested && !pythonCameraStopped) {
        startCameraStream();
    }
}

refreshButton?.addEventListener("click", refreshDashboard);
document.getElementById("refresh-monitoring")?.addEventListener("click", refreshDashboard);