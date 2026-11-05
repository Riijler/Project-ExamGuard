console.log("Dashboard JS Loaded");

const socket = io("http://localhost:3000");
const liveDetectionRows = new Map();
const hiddenActivityLogIdKey = "examguard-hidden-activity-through-id";
let studentRoster = [];
let activityViewGeneration = 0;

function getHiddenActivityLogId() {
    const storedId = Number(localStorage.getItem(hiddenActivityLogIdKey));
    return Number.isSafeInteger(storedId) && storedId > 0 ? storedId : 0;
}

function showEmptyActivityRow(tbody, message = "Belum ada aktivitas") {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty-activity-row";
    cell.textContent = message;
    row.appendChild(cell);
    tbody.replaceChildren(row);
}

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
        "Backend Terhubung";

    document.getElementById("status-description").textContent =
        "Mengambil statistik dari database";

    document.getElementById("status-dot").classList.add("connected");
    loadDashboardSummary();
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
    loadDashboardSummary();
});

socket.on("monitoring:updated", (data) => {
    console.log("Log aktivitas diperbarui:", data);
    loadMonitoringLogs();
});

socket.on("monitoring:deleted", () => {
    loadMonitoringLogs();
    loadDashboardSummary();
    if (allActivityDialog?.open) {
        showAllActivities();
    }
});

socket.on("violation:new", (data) => {
    console.log("Pelanggaran baru:", data);

    loadDashboardSummary();
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

async function loadDashboardSummary() {
    try {
        const response = await fetch("http://localhost:3000/api/dashboard/summary");
        if (!response.ok) {
            throw new Error(`Ringkasan dashboard gagal dimuat (${response.status})`);
        }
        const summary = await response.json();
        document.getElementById("total-students").textContent = summary.total_students;
        document.getElementById("total-connected").textContent = summary.connected_devices;
        document.getElementById("total-violations").textContent = summary.total_violations;
    } catch (error) {
        console.error("Gagal memuat ringkasan dashboard dari database:", error);
    }
}

loadDashboardSummary();
setInterval(loadDashboardSummary, 3000);

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
    for (let slot = 1; slot <= 10; slot += 1) {
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
        loadDashboardSummary();
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

async function loadMonitoringLogs() {
    const requestGeneration = activityViewGeneration;
    try {
        const response = await fetch("http://localhost:3000/api/monitoring");
        if (!response.ok) {
            throw new Error(`Log aktivitas gagal dimuat (${response.status})`);
        }
        const logs = await response.json();
        if (requestGeneration !== activityViewGeneration) {
            return;
        }

        const activityLog = document.getElementById("activity-log");
        const hiddenThroughId = getHiddenActivityLogId();
        const visibleLogs = logs.filter((log) => Number(log.id) > hiddenThroughId);
        activityLog.replaceChildren();

        visibleLogs.forEach(log => {
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
            actionCell.appendChild(createDeleteLogButton(log.id));
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
            showEmptyActivityRow(activityLog);
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

function createDeleteLogButton(logId) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-log-button";
    deleteButton.textContent = "Hapus";
    deleteButton.setAttribute("aria-label", `Hapus log ${logId} dari database`);
    deleteButton.addEventListener("click", () => deleteMonitoringLog(logId));
    return deleteButton;
}

async function resetActivityDisplay() {
    const resetButton = document.getElementById("reset-activity-view");
    resetButton.disabled = true;
    try {
        const response = await fetch("http://localhost:3000/api/monitoring");
        if (!response.ok) {
            throw new Error(`Tidak dapat memuat log (${response.status})`);
        }

        const logs = await response.json();
        const latestLogId = logs.reduce(
            (latestId, log) => Math.max(latestId, Number(log.id) || 0),
            getHiddenActivityLogId()
        );
        localStorage.setItem(hiddenActivityLogIdKey, String(latestLogId));

        activityViewGeneration += 1;
        liveDetectionRows.clear();
        showEmptyActivityRow(document.getElementById("activity-log"), "Tampilan log direset");
        if (allActivityDialog.open) {
            await showAllActivities();
        }
    } catch (error) {
        console.error("Gagal mereset tampilan log aktivitas:", error);
        window.alert(`Tampilan log gagal direset: ${error.message}`);
    } finally {
        resetButton.disabled = false;
    }
}

async function deleteMonitoringLog(logId) {
    if (!window.confirm("Hapus aktivitas ini dari database? Tindakan ini tidak dapat dibatalkan.")) {
        return;
    }

    try {
        const response = await fetch(`http://localhost:3000/api/monitoring/${logId}`, {
            method: "DELETE"
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || `Gagal menghapus aktivitas (${response.status})`);
        }

        await loadMonitoringLogs();
        loadDashboardSummary();
        if (allActivityDialog.open) {
            await showAllActivities();
        }
    } catch (error) {
        console.error("Gagal menghapus log aktivitas:", error);
        window.alert(error.message);
    }
}

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

    if (log.id && log.student_id) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-log-button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => openEditLog(log));
        actionCell.appendChild(editButton);
        actionCell.appendChild(createDeleteLogButton(log.id));
    } else if (log.isLive) {
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
        const visibleLogs = logs.filter((log) =>
            Number(log.id) > getHiddenActivityLogId()
        );
        visibleLogs.forEach((log) => appendAllActivityRow(tbody, log));

        const knownLogKeys = new Set(visibleLogs.map((log) =>
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

        if (visibleLogs.length === 0 && liveCount === 0) {
            showEmptyActivityRow(tbody);
        }
        message.textContent = liveCount
            ? `${visibleLogs.length} log tersimpan, ${liveCount} aktivitas live.`
            : `${visibleLogs.length} log aktivitas.`;
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
document.getElementById("reset-activity-view")?.addEventListener("click", resetActivityDisplay);
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
const webcamPreview = document.getElementById("webcam-preview");
const cameraMessage = document.getElementById("camera-message");
const cameraStatusText = document.getElementById("camera-status-text");
const streamUrl = "http://127.0.0.1:5000/frame.jpg";
const cameraApiUrl = "http://127.0.0.1:5000";
let cameraRefreshTimer;
let webcamStream;
let pythonCameraStopped = false;
let cameraStreamRequested = false;
let streamConnecting = false;
let restartPending = false;
let allowBrowserWebcamFallback = false;
let webcamFallbackAttempted = false;
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

async function loadAvailableCameras() {
    const select = document.getElementById("camera-device-select");
    const applyButton = document.getElementById("select-camera-device");
    if (!select || !applyButton) {
        return;
    }

    select.disabled = true;
    applyButton.disabled = true;
    select.replaceChildren();
    const loadingOption = document.createElement("option");
    loadingOption.value = "";
    loadingOption.textContent = "Memeriksa webcam...";
    select.appendChild(loadingOption);

    let permissionError;
    let permissionStream;
    try {
        permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
        });
    } catch (error) {
        permissionError = error;
    } finally {
        permissionStream?.getTracks().forEach((track) => track.stop());
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");
        if (videoDevices.length > 0) {
            const currentValue = select.dataset.currentValue;
            select.replaceChildren();
            videoDevices.forEach((device, index) => {
                const option = document.createElement("option");
                option.value = `device:${device.deviceId}`;
                option.textContent = device.label || `Webcam ${index + 1}`;
                select.appendChild(option);
            });
            if (videoDevices.some((device) => `device:${device.deviceId}` === currentValue)) {
                select.value = currentValue;
            }
            select.dataset.currentValue = select.value;
            select.disabled = false;
            applyButton.disabled = false;
            return;
        }

        const response = await fetch(`${cameraApiUrl}/cameras`);
        if (response.ok) {
            const result = await response.json();
            result.cameras.forEach(({ index }) => {
                const option = document.createElement("option");
                option.value = `index:${index}`;
                option.textContent = `Webcam index ${index}`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error("Gagal membaca daftar webcam:", error);
    }

    if (select.options.length > 0 && select.options[0].value) {
        select.dataset.currentValue = select.value;
        select.disabled = false;
        applyButton.disabled = false;
        return;
    }

    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = permissionError
        ? "Izinkan akses kamera di browser"
        : "Webcam tidak ditemukan";
    select.appendChild(option);
    select.disabled = true;
    applyButton.disabled = true;
    if (permissionError) {
        console.error("Izin webcam browser gagal:", permissionError);
        cameraMessage.textContent =
            permissionError.name === "NotAllowedError"
                ? "Izin kamera browser ditolak. Izinkan kamera untuk localhost, lalu klik Cari Webcam."
                : permissionError.message || "Browser tidak dapat membuka webcam.";
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "IZIN WEBCAM";
    }
}

async function loadMediaPipeCameras() {
    const select = document.getElementById("mediapipe-camera-select");
    const applyButton = document.getElementById("select-mediapipe-camera");
    if (!select || !applyButton) {
        return;
    }

    select.disabled = true;
    applyButton.disabled = true;
    select.replaceChildren();
    const loadingOption = document.createElement("option");
    loadingOption.value = "";
    loadingOption.textContent = "Memeriksa kamera MediaPipe...";
    select.appendChild(loadingOption);

    try {
        const [camerasResponse, statusResponse] = await Promise.all([
            fetch(`${cameraApiUrl}/cameras`),
            fetch(`${cameraApiUrl}/status`)
        ]);
        if (!camerasResponse.ok || !statusResponse.ok) {
            throw new Error("MediaPipe tidak terhubung. Jalankan ulang aplikasi.");
        }

        const { cameras } = await camerasResponse.json();
        const status = await statusResponse.json();
        select.replaceChildren();
        cameras.forEach(({ index }) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = `Index ${index}${index === status.cameraIndex ? " (aktif)" : ""}`;
            select.appendChild(option);
        });

        if (cameras.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "Webcam tidak terdeteksi oleh MediaPipe";
            select.appendChild(option);
            return;
        }

        if (cameras.some(({ index }) => index === status.cameraIndex)) {
            select.value = String(status.cameraIndex);
        }
        select.dataset.currentValue = select.value;
        select.disabled = false;
        applyButton.disabled = false;
    } catch (error) {
        console.error("Gagal mencari webcam untuk MediaPipe:", error);
        select.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "MediaPipe tidak terhubung — jalankan ulang aplikasi";
        select.appendChild(option);
        cameraMessage.textContent = error.message;
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "MEDIAPIPE OFFLINE";
    }
}

async function selectCameraDevice() {
    const select = document.getElementById("camera-device-select");
    const applyButton = document.getElementById("select-camera-device");
    if (!select || !select.value || !applyButton) {
        return;
    }

    applyButton.disabled = true;
    applyButton.textContent = "Membuka...";
    const selectedOption = select.options[select.selectedIndex];
    cameraMessage.textContent = `Membuka ${selectedOption.textContent}...`;
    cameraMessage.hidden = false;
    cameraStatusText.textContent = "MENGGANTI WEBCAM";

    try {
        if (select.value.startsWith("device:")) {
            await startBrowserWebcam(select.value.slice("device:".length));
            select.dataset.currentValue = select.value;
            return;
        }

        const response = await fetch(`${cameraApiUrl}/control/select-camera`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: Number(select.value.slice("index:".length)) })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Webcam gagal dipilih (${response.status})`);
        }

        cameraStreamRequested = true;
        restartPending = true;
        streamConnecting = false;
        clearTimeout(cameraRefreshTimer);
        cameraStream.onload = null;
        cameraStream.onerror = null;
        cameraStream.removeAttribute("src");
        cameraStream.hidden = true;
        stopBrowserWebcam();
        stopDetectionPolling();
    } catch (error) {
        console.error("Gagal memilih webcam:", error);
        cameraMessage.textContent = `${error.message}. Pastikan webcam tidak sedang dipakai aplikasi lain.`;
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "GAGAL";
    } finally {
        applyButton.disabled = false;
        applyButton.textContent = "Preview Webcam";
    }
}

async function selectMediaPipeCamera() {
    const select = document.getElementById("mediapipe-camera-select");
    const applyButton = document.getElementById("select-mediapipe-camera");
    if (!select || !select.value || !applyButton) {
        return;
    }

    applyButton.disabled = true;
    cameraMessage.textContent = `Memulai MediaPipe dengan kamera index ${select.value}...`;
    cameraMessage.hidden = false;
    cameraStatusText.textContent = "MENGGANTI WEBCAM";

    try {
        const response = await fetch(`${cameraApiUrl}/control/select-camera`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: Number(select.value) })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `MediaPipe gagal memilih index ${select.value}`);
        }

        cameraStreamRequested = true;
        restartPending = true;
        streamConnecting = false;
        clearTimeout(cameraRefreshTimer);
        cameraStream.onload = null;
        cameraStream.onerror = null;
        cameraStream.removeAttribute("src");
        cameraStream.hidden = true;
        stopBrowserWebcam();
        stopDetectionPolling();
        select.dataset.currentValue = select.value;
        cameraMessage.textContent = `MediaPipe sedang memulai ulang pada kamera index ${select.value}...`;
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "MEMULAI ULANG";
    } catch (error) {
        console.error("Gagal mengganti kamera MediaPipe:", error);
        cameraMessage.textContent =
            `${error.message}. Tutup aplikasi lain yang memakai webcam, lalu coba lagi.`;
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "GAGAL";
    } finally {
        applyButton.disabled = false;
    }
}

function stopBrowserWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach((track) => track.stop());
        webcamStream = undefined;
    }
    if (webcamPreview) {
        webcamPreview.srcObject = null;
        webcamPreview.hidden = true;
    }
}

async function startBrowserWebcam(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser ini tidak mendukung akses webcam. Buka aplikasi melalui localhost.");
    }

    clearTimeout(cameraRefreshTimer);
    cameraStream.onload = null;
    cameraStream.onerror = null;
    cameraStream.removeAttribute("src");
    cameraStream.hidden = true;
    stopBrowserWebcam();

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
            ? {
                deviceId: { exact: deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
            : { width: { ideal: 1280 }, height: { ideal: 720 } }
    });

    try {
        webcamPreview.srcObject = stream;
        await webcamPreview.play();
        webcamStream = stream;
        webcamPreview.hidden = false;
        cameraStream.hidden = true;
        cameraMessage.hidden = true;
        cameraStatusText.textContent = "WEBCAM LIVE";
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        webcamPreview.srcObject = null;
        throw error;
    }
}

function startCameraStream(options = {}) {
    if (!cameraStream || !webcamPreview || !cameraMessage || !cameraStatusText) {
        return;
    }

    if (webcamStream) {
        return;
    }

    if (pythonCameraStopped) {
        if (!options.allowBrowserWebcamFallback) {
            cameraMessage.textContent = "MediaPipe dihentikan. Klik Kamera untuk mencoba webcam browser.";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "OFFLINE";
            return;
        }
    }

    allowBrowserWebcamFallback = Boolean(options.allowBrowserWebcamFallback);
    webcamFallbackAttempted = false;
    cameraStreamRequested = true;
    streamConnecting = true;
    clearTimeout(cameraRefreshTimer);
    cameraMessage.textContent = "Menghubungkan ke webcam...";
    cameraMessage.hidden = false;
    cameraStream.hidden = true;
    cameraStatusText.textContent = "MENGHUBUNGKAN";

    const requestNextFrame = () => {
        cameraStream.src = `${streamUrl}?t=${Date.now()}`;
    };

    cameraStream.onload = () => {
        streamConnecting = false;
        stopBrowserWebcam();
        cameraStream.hidden = false;
        cameraMessage.hidden = true;
        cameraStatusText.textContent = "LIVE";
        cameraRefreshTimer = setTimeout(requestNextFrame, 150);
    };

    cameraStream.onerror = () => {
        streamConnecting = false;
        if (webcamStream) {
            return;
        }
        cameraStream.hidden = true;
        if (allowBrowserWebcamFallback && !webcamFallbackAttempted) {
            webcamFallbackAttempted = true;
            cameraMessage.textContent = "Stream MediaPipe tidak tersedia. Meminta izin webcam browser...";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "MEMINTA IZIN";
            startBrowserWebcam().catch((error) => {
                console.error("Gagal mengakses webcam browser:", error);
                const messages = {
                    NotAllowedError: "Akses webcam ditolak. Izinkan kamera di pengaturan browser lalu klik Kamera lagi.",
                    NotFoundError: "Webcam tidak ditemukan. Sambungkan kamera lalu coba lagi.",
                    NotReadableError: "Webcam sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi."
                };
                cameraMessage.textContent =
                    messages[error.name] || error.message || "Webcam gagal dibuka. Periksa izin kamera browser.";
                cameraMessage.hidden = false;
                cameraStatusText.textContent = "OFFLINE";
            });
        } else if (!webcamStream) {
            cameraMessage.textContent =
                "Menunggu stream MediaPipe. Klik Kamera untuk meminta akses webcam browser.";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "OFFLINE";
        }
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
    const cameraSelect = document.getElementById("camera-device-select");
    if (cameraSelect && status.cameraIndex !== undefined &&
        Array.from(cameraSelect.options).some((option) => option.value === String(status.cameraIndex))) {
        cameraSelect.value = String(status.cameraIndex);
    }
    if (status.cameraRunning && restartPending && cameraStreamRequested &&
        cameraStream.hidden && !webcamStream && !streamConnecting) {
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
    if (action === "stop") {
        cameraStreamRequested = false;
        streamConnecting = false;
        stopDetectionPolling();
        clearTimeout(cameraRefreshTimer);
        cameraStream.onload = null;
        cameraStream.onerror = null;
        cameraStream.removeAttribute("src");
        cameraStream.hidden = true;
        stopBrowserWebcam();
        cameraMessage.textContent = "Kamera dihentikan.";
        cameraMessage.hidden = false;
        cameraStatusText.textContent = "OFFLINE";
    }

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
            pythonCameraStopped = true;
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
            stopBrowserWebcam();
            cameraMessage.textContent = "Memulai ulang deteksi MediaPipe...";
            cameraMessage.hidden = false;
            cameraStatusText.textContent = "MEMULAI ULANG";
        }
    } catch (error) {
        console.error(`Gagal menjalankan kontrol kamera (${action}):`, error);
        if (action === "stop") {
            pythonCameraStopped = true;
            cameraMessage.textContent = "Webcam browser dihentikan. MediaPipe tidak terhubung.";
            cameraStatusText.textContent = "OFFLINE";
        }
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

const requestCameraAccess = () => startCameraStream({ allowBrowserWebcamFallback: true });
document.getElementById("activate-camera")?.addEventListener("click", requestCameraAccess);
document.getElementById("camera-button")?.addEventListener("click", requestCameraAccess);
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
document.getElementById("select-camera-device")?.addEventListener("click", selectCameraDevice);
document.getElementById("refresh-camera-devices")?.addEventListener("click", loadAvailableCameras);
document.getElementById("select-mediapipe-camera")?.addEventListener("click", selectMediaPipeCamera);
document.getElementById("refresh-mediapipe-cameras")?.addEventListener("click", loadMediaPipeCameras);
document.getElementById("camera-device-select")?.addEventListener("change", (event) => {
    event.currentTarget.dataset.currentValue = event.currentTarget.value;
});

refreshCameraControls();
loadAvailableCameras();
loadMediaPipeCameras();
setInterval(refreshCameraControls, 2000);
startCameraStream();
startDetectionPolling();

const refreshButton = document.getElementById("refresh-dashboard");

function refreshDashboard() {
    loadDashboardSummary();
    loadMonitoringLogs();
    refreshCameraControls();

    if (cameraStreamRequested && !pythonCameraStopped) {
        startCameraStream();
    }
}

refreshButton?.addEventListener("click", refreshDashboard);
document.getElementById("refresh-monitoring")?.addEventListener("click", refreshDashboard);