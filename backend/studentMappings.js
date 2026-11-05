const studentMappings = new Map();

function getStudentIdForSlot(slot) {
    return studentMappings.get(String(slot));
}

function getMappedStudentIds() {
    return [...new Set(studentMappings.values())];
}

function getMappedStudentCount() {
    return getMappedStudentIds().length;
}

function replaceStudentMappings(mappings) {
    studentMappings.clear();
    for (const [slot, studentId] of mappings) {
        studentMappings.set(slot, studentId);
    }
}

module.exports = {
    getStudentIdForSlot,
    getMappedStudentIds,
    getMappedStudentCount,
    replaceStudentMappings
};
