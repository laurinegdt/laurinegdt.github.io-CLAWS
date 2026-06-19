(function (global) {
  var DEDUPE_MS = 3000;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDisplayDate(date) {
    return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
  }

  function formatDisplayTime(date) {
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function resolveClawId(clawId) {
    if (clawId) {
      return clawId;
    }
    return global.ClawStorage ? ClawStorage.getSelectedId() : null;
  }

  function getMySignal() {
    if (!global.ClawStorage) {
      return null;
    }
    var claw = ClawStorage.getSelectedClaw();
    return claw && claw.signal ? claw.signal : null;
  }

  function saveMySignal(name, message, clawId) {
    var id = resolveClawId(clawId);
    if (!id) {
      return null;
    }
    var claw = ClawStorage.saveClawSignal(id, name, message);
    return claw ? claw.signal : null;
  }

  function deleteMySignal(clawId) {
    var id = resolveClawId(clawId);
    if (!id) {
      return;
    }
    ClawStorage.deleteClawSignal(id);
  }

  function isDuplicate(entries, signalId) {
    if (!signalId) {
      return false;
    }
    var now = Date.now();
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].signalId === signalId) {
        var t = new Date(entries[i].detectedAt).getTime();
        if (!isNaN(t) && now - t < DEDUPE_MS) {
          return true;
        }
      }
    }
    return false;
  }

  function addSignalLogEntry(entry, clawId) {
    if (!global.ClawStorage) {
      return null;
    }

    var id = resolveClawId(clawId);
    if (!id) {
      return null;
    }

    var detectedAt = entry.detectedAt || new Date().toISOString();
    var dateObj = new Date(detectedAt);
    var log = ClawStorage.getClawSignalLog(id);

    if (isDuplicate(log, entry.signalId)) {
      return null;
    }

    var record = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      signalId: entry.signalId || '',
      name: entry.name || 'anonymous',
      description: entry.description || '',
      label: entry.name || 'anonymous',
      date: formatDisplayDate(dateObj),
      time: formatDisplayTime(dateObj),
      detectedAt: detectedAt
    };

    ClawStorage.addClawSignalLogEntry(id, record);
    return record;
  }

  function getSignalLog(clawId) {
    if (!global.ClawStorage) {
      return [];
    }
    var id = resolveClawId(clawId);
    return id ? ClawStorage.getClawSignalLog(id) : [];
  }

  function deleteSignalLogEntry(entryId, clawId) {
    if (!global.ClawStorage) {
      return;
    }
    var id = resolveClawId(clawId);
    if (!id) {
      return;
    }
    ClawStorage.deleteClawSignalLogEntry(id, entryId);
  }

  global.ClawSignal = {
    getMySignal: getMySignal,
    saveMySignal: saveMySignal,
    deleteMySignal: deleteMySignal,
    addSignalLogEntry: addSignalLogEntry,
    getSignalLog: getSignalLog,
    deleteSignalLogEntry: deleteSignalLogEntry
  };
})(window);
