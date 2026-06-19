(function (global) {
  var listeners = [];

  function onDetection(listener) {
    listeners.push(listener);
  }

  function emitDetection(entry) {
    listeners.forEach(function (fn) {
      fn(entry);
    });
  }

  function parseSignalLine(message) {
    if (!message || message.indexOf('SIGNAL|') !== 0) {
      return null;
    }
    var parts = message.split('|');
    if (parts.length < 4) {
      return null;
    }
    return {
      signalId: parts[1],
      name: parts[2],
      description: parts[3]
    };
  }

  function formatNotificationBody(entry) {
    return 'SIGNAL : ' + (entry.name || 'anonymous') + '    ' + (entry.description || '');
  }

  function requestNotificationsPermission() {
    if (!('Notification' in window)) {
      return Promise.resolve(false);
    }
    if (Notification.permission === 'granted') {
      return Promise.resolve(true);
    }
    if (Notification.permission === 'denied') {
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then(function (p) {
      return p === 'granted';
    });
  }

  function showNewSignalNotification(entry) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    new Notification('New detection', {
      body: formatNotificationBody(entry),
      tag: 'claw-signal-' + Date.now()
    });
  }

  function hookBleMessages() {
    if (!global.ClawBle || global.ClawBle._clawSignalHooked) {
      return;
    }
    global.ClawBle._clawSignalHooked = true;
    global.ClawBle.onMessage(function (message) {
      var normalized = String(message || '').trim();
      if (normalized.indexOf('SIGNAL|') !== 0) {
        return;
      }
      var entry = parseSignalLine(normalized);
      if (entry) {
        emitDetection(entry);
      }
    });
  }

  hookBleMessages();

  global.ClawSignalNotify = {
    onDetection: onDetection,
    showNewSignalNotification: showNewSignalNotification,
    requestNotificationsPermission: requestNotificationsPermission,
    formatNotificationBody: formatNotificationBody
  };
})(window);
