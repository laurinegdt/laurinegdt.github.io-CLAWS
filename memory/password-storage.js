(function (global) {
  var KEY_PENDING = 'claw-pending-password';

  function getSelectedClawId() {
    if (!global.ClawStorage || !ClawStorage.getSelectedId()) {
      return null;
    }
    return ClawStorage.getSelectedId();
  }

  function getPendingPassword() {
    try {
      var raw = sessionStorage.getItem(KEY_PENDING);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setPendingPassword(name, password) {
    sessionStorage.setItem(
      KEY_PENDING,
      JSON.stringify({ name: name, password: password })
    );
  }

  function clearPendingPassword() {
    sessionStorage.removeItem(KEY_PENDING);
  }

  function getActivePasswordEntry() {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    return ClawStorage.getActivePassword(clawId);
  }

  function setActivePassword(id) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    return ClawStorage.setActivePasswordId(clawId, id);
  }

  function getPasswords() {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return [];
    }
    return ClawStorage.getClawPasswords(clawId);
  }

  function savePassword(entry) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    var record = ClawStorage.saveClawPassword(clawId, entry);
    clearPendingPassword();
    return record;
  }

  function deletePassword(id) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return;
    }
    ClawStorage.deleteClawPassword(clawId, id);
  }

  function buildBlePayload(entry) {
    var seq = entry.activateBy === 'gesture' && entry.gestureSequence
      ? entry.gestureSequence.join(',')
      : '';
    return 'SET_PASSWORD|' + entry.password + '|' + entry.activateBy + '|' + seq;
  }

  function syncToDevice() {
    if (!global.ClawBle) {
      return Promise.resolve(false);
    }
    var passwords = getPasswords();
    if (!passwords.length) {
      return Promise.resolve(false);
    }
    var entry = getActivePasswordEntry() || passwords[0];
    var payload = buildBlePayload(entry);

    function trySync() {
      if (!global.ClawBle.isConnected()) {
        return global.ClawBle.restoreConnection().then(function (ok) {
          if (!ok) {
            return false;
          }
          return global.ClawBle.sendAndWaitForAck(payload, 'ACK|SET_PASSWORD', 8000).then(function () {
            return true;
          });
        });
      }
      return global.ClawBle.sendAndWaitForAck(payload, 'ACK|SET_PASSWORD', 8000).then(function () {
        return true;
      });
    }

    return trySync().catch(function () {
      return trySync().catch(function () {
        return false;
      });
    });
  }

  global.ClawPassword = {
    getPendingPassword: getPendingPassword,
    setPendingPassword: setPendingPassword,
    clearPendingPassword: clearPendingPassword,
    getPasswords: getPasswords,
    getActivePassword: getActivePasswordEntry,
    setActivePassword: setActivePassword,
    savePassword: savePassword,
    deletePassword: deletePassword,
    buildBlePayload: buildBlePayload,
    syncToDevice: syncToDevice
  };
})(window);
