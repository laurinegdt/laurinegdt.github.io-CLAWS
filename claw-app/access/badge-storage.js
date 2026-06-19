(function (global) {
  var KEY_PENDING = 'claw-pending-module';

  var MEMORY_OPTIONS = [
    '504 bytes · 135 pages · NTAG213',
    '888 bytes · 135 pages · NTAG215',
    '1.9 KB · 135 pages · NTAG216'
  ];

  var TECH_OPTIONS = [
    'NFC-A (ISO 14443-3A) · Type 2 Tag',
    'NFC-A · ISO-DEP · NTAG I²C',
    'NFC-A · MIFARE Ultralight EV1'
  ];

  function getSelectedClawId() {
    if (!global.ClawStorage || !ClawStorage.getSelectedId()) {
      return null;
    }
    return ClawStorage.getSelectedId();
  }

  function randomHexByte() {
    return Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0');
  }

  function generateUid() {
    return (
      randomHexByte() + ':' +
      randomHexByte() + ':' +
      randomHexByte() + ':' +
      randomHexByte() + ':' +
      randomHexByte() + ':' +
      randomHexByte() + ':' +
      randomHexByte()
    );
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function createScannedModule() {
    return {
      uid: generateUid(),
      memory: pick(MEMORY_OPTIONS),
      technology: pick(TECH_OPTIONS),
      scannedAt: new Date().toISOString()
    };
  }

  function setPendingModule(module) {
    sessionStorage.setItem(KEY_PENDING, JSON.stringify(module));
  }

  function getPendingModule() {
    try {
      var raw = sessionStorage.getItem(KEY_PENDING);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearPendingModule() {
    sessionStorage.removeItem(KEY_PENDING);
  }

  function getBadges() {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return [];
    }
    return ClawStorage.getClawBadges(clawId);
  }

  function saveBadge(name, module) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    var badge = ClawStorage.saveClawBadge(clawId, name, module);
    clearPendingModule();
    return badge;
  }

  function deleteBadge(id) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return;
    }
    ClawStorage.deleteClawBadge(clawId, id);
  }

  global.ClawBadge = {
    createScannedModule: createScannedModule,
    setPendingModule: setPendingModule,
    getPendingModule: getPendingModule,
    clearPendingModule: clearPendingModule,
    getBadges: getBadges,
    saveBadge: saveBadge,
    deleteBadge: deleteBadge
  };
})(window);
