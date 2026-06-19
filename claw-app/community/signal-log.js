(function () {
  if (!window.ClawStorage) {
    window.location.replace('../my-claw/my-claws.html');
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var clawId = params.get('id');
  if (clawId && ClawStorage.getClaw(clawId)) {
    ClawStorage.setSelectedId(clawId);
  }

  var claw = ClawStorage.getSelectedClaw();
  if (!claw) {
    window.location.replace('../my-claw/my-claws.html');
    return;
  }

  clawId = claw.id;

  if (window.ClawContext) {
    ClawContext.initBackLinks();
  }

  var clawLabelEl = document.getElementById('signal-log-claw');
  if (clawLabelEl) {
    clawLabelEl.textContent = claw.label;
  }

  var logList = document.getElementById('signal-log-list');
  var statusEl = document.getElementById('signal-log-status');
  var connectBtn = document.getElementById('signal-log-connect');

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderEntries(entries) {
    logList.innerHTML = '';
    if (!entries.length) {
      logList.innerHTML =
        '<li class="signal-log__empty">Waiting for a detection from the receiver…</li>';
      return;
    }

    entries.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'signal-log__item';
      li.innerHTML =
        '<div class="saved-item__content signal-log__content">' +
          '<p class="signal-log__check">✓ ' + escapeHtml(entry.name) + '</p>' +
          '<p class="signal-log__desc">' + escapeHtml(entry.description || '') + '</p>' +
          '<p class="signal-log__datetime">' + escapeHtml(entry.date + ' ' + entry.time) + '</p>' +
        '</div>' +
        '<button type="button" class="delete-btn" data-id="' + escapeHtml(entry.id) + '">Delete</button>';
      logList.appendChild(li);
    });
  }

  function refreshList() {
    renderEntries(ClawSignal.getSignalLog(clawId));
  }

  function onNewDetection(entry) {
    var saved = ClawSignal.addSignalLogEntry(entry, clawId);
    if (!saved) {
      return;
    }
    refreshList();
    if (window.ClawSignalNotify) {
      ClawSignalNotify.showNewSignalNotification(saved);
    }
  }

  function refreshStatus() {
    if (!statusEl) {
      return;
    }
    if (!navigator.bluetooth) {
      statusEl.textContent = 'Web Bluetooth unavailable — use Chrome on localhost';
      if (connectBtn) {
        connectBtn.disabled = true;
      }
      return;
    }
    if (window.ClawBle && ClawBle.isReceiverDevice && ClawBle.isReceiverDevice()) {
      if (Notification.permission === 'granted') {
        statusEl.textContent = 'Receiver connected — notification when it vibrates';
      } else {
        statusEl.textContent = 'Receiver connected — allow notifications to get alerts';
      }
      if (connectBtn) {
        connectBtn.textContent = 'Disconnect receiver';
      }
      return;
    }
    if (connectBtn) {
      connectBtn.textContent = 'Connect receiver';
    }
    statusEl.textContent = 'Connect the receiver once — then leave this page open';
  }

  function connectReceiverFlow() {
    if (!window.ClawBle || !ClawBle.connectReceiver) {
      return Promise.reject(new Error('BLE not available'));
    }
    return ClawSignalNotify.requestNotificationsPermission().then(function () {
      return ClawBle.connectReceiver();
    });
  }

  if (window.ClawSignalNotify) {
    ClawSignalNotify.onDetection(onNewDetection);
  }

  if (connectBtn && window.ClawBle) {
    connectBtn.addEventListener('click', function () {
      if (ClawBle.isReceiverDevice && ClawBle.isReceiverDevice()) {
        connectBtn.disabled = true;
        ClawBle.disconnect().finally(function () {
          connectBtn.disabled = false;
          refreshStatus();
        });
        return;
      }

      connectBtn.disabled = true;
      connectReceiverFlow()
        .catch(function (err) {
          alert('Could not connect receiver:\n\n' + (err.message || err));
        })
        .finally(function () {
          connectBtn.disabled = false;
          refreshStatus();
        });
    });
  }

  if (window.ClawBle && ClawBle.onConnectionChange) {
    ClawBle.onConnectionChange(refreshStatus);
  }

  refreshStatus();
  refreshList();

  ClawSignalNotify.requestNotificationsPermission().then(function () {
    if (window.ClawBle && ClawBle.connectReceiver) {
      return ClawBle.connectReceiver().catch(function () {
        // User must tap Connect once — picker needs a gesture if silent reconnect fails.
      });
    }
  }).finally(refreshStatus);

  logList.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-btn');
    if (!btn) {
      return;
    }
    ClawSignal.deleteSignalLogEntry(btn.getAttribute('data-id'), clawId);
    btn.closest('.signal-log__item').remove();
    if (!logList.querySelector('.signal-log__item')) {
      logList.innerHTML =
        '<li class="signal-log__empty">Waiting for a detection from the receiver…</li>';
    }
  });
})();
