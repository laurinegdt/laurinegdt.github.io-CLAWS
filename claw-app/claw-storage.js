(function (global) {
  var KEY_CLAWS = 'claw-claws';
  var KEY_SELECTED = 'claw-selected-id';
  var KEY_MIGRATED = 'claw-storage-migrated-v1';
  var KEY_SIGNAL_LOG_MIGRATED = 'claw-signal-log-migrated-v2';
  var KEY_LEGACY_SIGNAL = 'claw-my-signal';
  var KEY_LEGACY_SIGNAL_LOG = 'claw-signal-log';
  var KEY_LEGACY_PASSWORDS = 'claw-passwords';
  var KEY_LEGACY_BADGES = 'claw-badges';

  function generateId() {
    return 'claw-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeClaws(claws) {
    localStorage.setItem(KEY_CLAWS, JSON.stringify(claws));
  }

  function normalizeClaw(claw) {
    claw.passwords = claw.passwords || [];
    claw.badges = claw.badges || [];
    claw.nfcConfigs = claw.nfcConfigs || [];
    if (claw.activePasswordId === undefined) {
      claw.activePasswordId = null;
    }
    if (claw.activeNfcId === undefined) {
      claw.activeNfcId = null;
    }
    claw.signalLog = claw.signalLog || [];
    if (claw.accessMode !== 'password' && claw.accessMode !== 'nfc') {
      if (claw.activeNfcId && !claw.activePasswordId) {
        claw.accessMode = 'nfc';
      } else if (claw.activePasswordId) {
        claw.accessMode = 'password';
        if (claw.activeNfcId) {
          claw.activeNfcId = null;
        }
      } else {
        claw.accessMode = null;
      }
    }
    if (claw.accessMode === 'password' && claw.activeNfcId) {
      claw.activeNfcId = null;
    }
    if (claw.accessMode === 'nfc' && claw.activePasswordId) {
      claw.activePasswordId = null;
    }
    return claw;
  }

  function migrateLegacyData() {
    if (localStorage.getItem(KEY_MIGRATED)) {
      return;
    }

    var claws = readJson(KEY_CLAWS, []);
    if (!claws.length) {
      var signal = readJson(KEY_LEGACY_SIGNAL, null);
      var passwords = readJson(KEY_LEGACY_PASSWORDS, []);
      var badges = readJson(KEY_LEGACY_BADGES, []);

      if (signal || passwords.length || badges.length) {
        var label = 'My claw';
        if (signal && signal.name && signal.name !== 'anonymous') {
          label = signal.name;
        }
        claws.push(normalizeClaw({
          id: generateId(),
          label: label,
          createdAt: new Date().toISOString(),
          signal: signal,
          passwords: passwords,
          badges: badges,
          nfcConfigs: [],
          activePasswordId: passwords.length ? passwords[0].id : null,
          activeNfcId: null
        }));
        writeClaws(claws);
        if (!sessionStorage.getItem(KEY_SELECTED)) {
          sessionStorage.setItem(KEY_SELECTED, claws[0].id);
        }
      }
    }

    localStorage.setItem(KEY_MIGRATED, '1');
  }

  function migrateLegacySignalLog() {
    if (localStorage.getItem(KEY_SIGNAL_LOG_MIGRATED)) {
      return;
    }
    localStorage.setItem(KEY_SIGNAL_LOG_MIGRATED, '1');

    var legacy = readJson(KEY_LEGACY_SIGNAL_LOG, []);
    if (!legacy.length) {
      return;
    }

    var claws = readJson(KEY_CLAWS, []).map(normalizeClaw);
    if (!claws.length) {
      localStorage.removeItem(KEY_LEGACY_SIGNAL_LOG);
      return;
    }

    var targetId = sessionStorage.getItem(KEY_SELECTED) || claws[0].id;
    for (var i = 0; i < claws.length; i++) {
      if (claws[i].id === targetId) {
        claws[i].signalLog = legacy.concat(claws[i].signalLog || []).slice(0, 100);
        writeClaws(claws);
        break;
      }
    }

    localStorage.removeItem(KEY_LEGACY_SIGNAL_LOG);
  }

  function getClaws() {
    migrateLegacyData();
    migrateLegacySignalLog();
    return readJson(KEY_CLAWS, []).map(normalizeClaw);
  }

  function getClaw(id) {
    if (!id) {
      return null;
    }
    var claw = getClaws().filter(function (c) {
      return c.id === id;
    })[0];
    return claw ? normalizeClaw(Object.assign({}, claw)) : null;
  }

  function getSelectedId() {
    return sessionStorage.getItem(KEY_SELECTED);
  }

  function setSelectedId(id) {
    if (id) {
      sessionStorage.setItem(KEY_SELECTED, id);
    } else {
      sessionStorage.removeItem(KEY_SELECTED);
    }
  }

  function getSelectedClaw() {
    return getClaw(getSelectedId());
  }

  function updateClawRecord(id, updater) {
    var claws = getClaws();
    var index = -1;
    for (var i = 0; i < claws.length; i++) {
      if (claws[i].id === id) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      return null;
    }
    var next = normalizeClaw(updater(Object.assign({}, claws[index])));
    claws[index] = next;
    writeClaws(claws);
    return next;
  }

  function createClaw(options) {
    var claws = getClaws();
    var label = (options && options.label) || ('Claw ' + (claws.length + 1));
    var claw = normalizeClaw({
      id: generateId(),
      label: label,
      createdAt: new Date().toISOString(),
      accessMode: options && (options.accessMode === 'password' || options.accessMode === 'nfc')
        ? options.accessMode
        : null,
      signal: null,
      passwords: [],
      badges: [],
      nfcConfigs: [],
      activePasswordId: null,
      activeNfcId: null
    });
    claws.unshift(claw);
    writeClaws(claws);
    setSelectedId(claw.id);
    return claw;
  }

  function deleteClaw(id) {
    var claws = getClaws().filter(function (claw) {
      return claw.id !== id;
    });
    writeClaws(claws);
    if (getSelectedId() === id) {
      setSelectedId(claws.length ? claws[0].id : null);
    }
  }

  function saveClawSignal(clawId, name, message) {
    var payload = {
      name: name,
      message: message,
      savedAt: new Date().toISOString()
    };
    return updateClawRecord(clawId, function (claw) {
      claw.signal = payload;
      if (name && name !== 'anonymous') {
        claw.label = name;
      }
      return claw;
    });
  }

  function deleteClawSignal(clawId) {
    return updateClawRecord(clawId, function (claw) {
      claw.signal = null;
      return claw;
    });
  }

  function getClawPasswords(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    return claw && claw.passwords ? claw.passwords.slice() : [];
  }

  function saveClawPassword(clawId, entry) {
    var record = {
      id: Date.now().toString(36),
      name: entry.name,
      password: entry.password,
      activateBy: entry.activateBy,
      gestureSequence: entry.gestureSequence || null,
      savedAt: new Date().toISOString()
    };
    updateClawRecord(clawId, function (claw) {
      claw.passwords = [record].concat(claw.passwords || []);
      claw.accessMode = 'password';
      claw.activeNfcId = null;
      if (!claw.activePasswordId) {
        claw.activePasswordId = record.id;
      }
      return claw;
    });
    return record;
  }

  function deleteClawPassword(clawId, passwordId) {
    updateClawRecord(clawId, function (claw) {
      claw.passwords = (claw.passwords || []).filter(function (item) {
        return item.id !== passwordId;
      });
      if (claw.activePasswordId === passwordId) {
        claw.activePasswordId = claw.passwords.length ? claw.passwords[0].id : null;
      }
      return claw;
    });
  }

  function setActivePasswordId(clawId, passwordId) {
    return updateClawRecord(clawId, function (claw) {
      if (!passwordId) {
        claw.activePasswordId = null;
        return claw;
      }
      var exists = (claw.passwords || []).some(function (p) {
        return p.id === passwordId;
      });
      if (exists) {
        claw.activePasswordId = passwordId;
        claw.accessMode = 'password';
        claw.activeNfcId = null;
      }
      return claw;
    });
  }

  function getActivePassword(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    if (!claw || !claw.activePasswordId) {
      return null;
    }
    return (claw.passwords || []).filter(function (p) {
      return p.id === claw.activePasswordId;
    })[0] || null;
  }

  function getClawNfcConfigs(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    return claw && claw.nfcConfigs ? claw.nfcConfigs.slice() : [];
  }

  function saveClawNfcConfig(clawId, entry) {
    var record = {
      id: Date.now().toString(36),
      title: entry.title,
      type: entry.type,
      payload: entry.payload,
      savedAt: new Date().toISOString()
    };
    updateClawRecord(clawId, function (claw) {
      claw.nfcConfigs = [record].concat(claw.nfcConfigs || []);
      claw.accessMode = 'nfc';
      claw.activePasswordId = null;
      if (!claw.activeNfcId) {
        claw.activeNfcId = record.id;
      }
      return claw;
    });
    return record;
  }

  function deleteClawNfcConfig(clawId, nfcId) {
    updateClawRecord(clawId, function (claw) {
      claw.nfcConfigs = (claw.nfcConfigs || []).filter(function (item) {
        return item.id !== nfcId;
      });
      if (claw.activeNfcId === nfcId) {
        claw.activeNfcId = claw.nfcConfigs.length ? claw.nfcConfigs[0].id : null;
      }
      return claw;
    });
  }

  function setActiveNfcId(clawId, nfcId) {
    return updateClawRecord(clawId, function (claw) {
      if (!nfcId) {
        claw.activeNfcId = null;
        return claw;
      }
      var exists = (claw.nfcConfigs || []).some(function (n) {
        return n.id === nfcId;
      });
      if (exists) {
        claw.activeNfcId = nfcId;
        claw.accessMode = 'nfc';
        claw.activePasswordId = null;
      }
      return claw;
    });
  }

  function getActiveNfc(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    if (!claw || !claw.activeNfcId) {
      return null;
    }
    return (claw.nfcConfigs || []).filter(function (n) {
      return n.id === claw.activeNfcId;
    })[0] || null;
  }

  function getClawBadges(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    return claw && claw.badges ? claw.badges.slice() : [];
  }

  function saveClawBadge(clawId, name, module) {
    var badge = {
      id: Date.now().toString(36),
      name: name,
      uid: module.uid,
      memory: module.memory,
      technology: module.technology,
      savedAt: new Date().toISOString()
    };
    updateClawRecord(clawId, function (claw) {
      claw.badges = [badge].concat(claw.badges || []);
      return claw;
    });
    return badge;
  }

  function deleteClawBadge(clawId, badgeId) {
    updateClawRecord(clawId, function (claw) {
      claw.badges = (claw.badges || []).filter(function (badge) {
        return badge.id !== badgeId;
      });
      return claw;
    });
  }

  function getClawSignalLog(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    return claw && claw.signalLog ? claw.signalLog.slice() : [];
  }

  function addClawSignalLogEntry(clawId, record) {
    return updateClawRecord(clawId, function (claw) {
      claw.signalLog = [record].concat(claw.signalLog || []).slice(0, 100);
      return claw;
    });
  }

  function deleteClawSignalLogEntry(clawId, entryId) {
    return updateClawRecord(clawId, function (claw) {
      claw.signalLog = (claw.signalLog || []).filter(function (entry) {
        return entry.id !== entryId;
      });
      return claw;
    });
  }

  function getAccessMode(clawId) {
    var claw = getClaw(clawId || getSelectedId());
    return claw ? claw.accessMode : null;
  }

  function setAccessMode(clawId, mode) {
    if (mode !== 'password' && mode !== 'nfc') {
      return null;
    }
    return updateClawRecord(clawId, function (claw) {
      claw.accessMode = mode;
      if (mode === 'password') {
        claw.activeNfcId = null;
      } else {
        claw.activePasswordId = null;
      }
      return claw;
    });
  }

  function requireAccessMode(clawId, mode, redirectUrl) {
    var claw = getClaw(clawId || getSelectedId());
    if (!claw || claw.accessMode !== mode) {
      if (typeof window !== 'undefined' && redirectUrl) {
        window.location.replace(redirectUrl);
      }
      return false;
    }
    return true;
  }

  function getClawDetailUrl(clawId) {
    return '../my-claw/my-claw.html?id=' + encodeURIComponent(clawId);
  }

  function requireSelectedOrRedirect(url) {
    if (!getSelectedClaw()) {
      window.location.replace(url || '../my-claw/my-claws.html');
      return false;
    }
    return true;
  }

  global.ClawStorage = {
    getClaws: getClaws,
    getClaw: getClaw,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    getSelectedClaw: getSelectedClaw,
    createClaw: createClaw,
    deleteClaw: deleteClaw,
    saveClawSignal: saveClawSignal,
    deleteClawSignal: deleteClawSignal,
    getClawPasswords: getClawPasswords,
    saveClawPassword: saveClawPassword,
    deleteClawPassword: deleteClawPassword,
    setActivePasswordId: setActivePasswordId,
    getActivePassword: getActivePassword,
    getClawNfcConfigs: getClawNfcConfigs,
    saveClawNfcConfig: saveClawNfcConfig,
    deleteClawNfcConfig: deleteClawNfcConfig,
    setActiveNfcId: setActiveNfcId,
    getActiveNfc: getActiveNfc,
    getAccessMode: getAccessMode,
    setAccessMode: setAccessMode,
    requireAccessMode: requireAccessMode,
    getClawBadges: getClawBadges,
    saveClawBadge: saveClawBadge,
    deleteClawBadge: deleteClawBadge,
    getClawSignalLog: getClawSignalLog,
    addClawSignalLogEntry: addClawSignalLogEntry,
    deleteClawSignalLogEntry: deleteClawSignalLogEntry,
    getClawDetailUrl: getClawDetailUrl,
    requireSelectedOrRedirect: requireSelectedOrRedirect
  };
})(window);
