(function (global) {
  var SERVICE_UUID = '12345678-1234-1234-1234-123456789012';
  var TX_CHARACTERISTIC_UUID = '87654321-4321-4321-4321-210987654321';
  var RX_CHARACTERISTIC_UUID = '11111111-2222-3333-4444-555555555555';
  var DEVICE_NAME = 'XIAOChat';
  var NFC_DEVICE_NAME = 'XIAONFC';
  var RECEIVER_DEVICE_NAME = 'CLAWRecv';
  var KNOWN_DEVICE_NAMES = [DEVICE_NAME, NFC_DEVICE_NAME, RECEIVER_DEVICE_NAME];
  var DEVICE_ID_KEY = 'claw-ble-device-id';
  var RECONNECT_DELAY_MS = 300;
  var HEALTH_CHECK_MS = 1500;
  var KEEPALIVE_MS = 10000;

  var bluetoothDevice = null;
  var txCharacteristic = null;
  var rxCharacteristic = null;
  var messageListeners = [];
  var connectionListeners = [];
  var manualDisconnect = false;
  var reconnectTimer = null;
  var healthTimer = null;
  var keepaliveTimer = null;
  var reconnectInProgress = null;
  var reconnectAttempt = 0;
  var txBusy = false;

  function isConnected() {
    return !!(bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected && rxCharacteristic);
  }

  function isKnownDevice() {
    return !!bluetoothDevice;
  }

  function onMessage(listener) {
    messageListeners.push(listener);
  }

  function offMessage(listener) {
    messageListeners = messageListeners.filter(function (fn) {
      return fn !== listener;
    });
  }

  function emitMessage(message) {
    messageListeners.forEach(function (listener) {
      listener(message);
    });
  }

  function emitConnectionChange() {
    connectionListeners.forEach(function (listener) {
      listener(isConnected(), bluetoothDevice ? bluetoothDevice.name : null);
    });
  }

  function onConnectionChange(listener) {
    connectionListeners.push(listener);
  }

  function offConnectionChange(listener) {
    connectionListeners = connectionListeners.filter(function (fn) {
      return fn !== listener;
    });
  }

  function getDeviceName() {
    return bluetoothDevice ? bluetoothDevice.name : null;
  }

  function rememberDevice(device) {
    if (device && device.id) {
      try {
        sessionStorage.setItem(DEVICE_ID_KEY, device.id);
      } catch (err) {
        // sessionStorage may be unavailable in some contexts.
      }
    }
  }

  function getRememberedDeviceId() {
    try {
      return sessionStorage.getItem(DEVICE_ID_KEY);
    } catch (err) {
      return null;
    }
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(function () {
      if (manualDisconnect || !isConnected() || txBusy) {
        return;
      }
      send('PING').catch(function () {});
    }, KEEPALIVE_MS);
  }

  function clearCharacteristics() {
    if (txCharacteristic) {
      txCharacteristic.removeEventListener('characteristicvaluechanged', handleNotification);
    }
    txCharacteristic = null;
    rxCharacteristic = null;
  }

  function handleNotification(event) {
    var decoder = new TextDecoder('utf-8');
    var message = decoder.decode(event.target.value);
    emitMessage(message);
  }

  function scheduleReconnect() {
    if (manualDisconnect) {
      return;
    }
    clearTimeout(reconnectTimer);
    var delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempt), 5000);
    reconnectTimer = setTimeout(function () {
      reconnectKnownDevice().catch(function () {});
    }, delay);
  }

  function onDisconnected() {
    stopKeepalive();
    clearCharacteristics();
    emitMessage('__DISCONNECTED__');
    emitConnectionChange();
    reconnectAttempt += 1;
    scheduleReconnect();
  }

  function bindDisconnectListener(device) {
    if (device._clawDisconnectBound) {
      return;
    }
    device.addEventListener('gattserverdisconnected', function () {
      if (bluetoothDevice !== device) {
        return;
      }
      onDisconnected();
    });
    device._clawDisconnectBound = true;
  }

  async function setupGatt(device) {
    if (!device || !device.gatt) {
      throw new Error('Invalid Bluetooth device');
    }

    bluetoothDevice = device;
    rememberDevice(device);
    bindDisconnectListener(device);

    if (!device.gatt.connected) {
      await device.gatt.connect();
    }

    var service = await device.gatt.getPrimaryService(SERVICE_UUID);
    var nextTx = await service.getCharacteristic(TX_CHARACTERISTIC_UUID);
    var nextRx = await service.getCharacteristic(RX_CHARACTERISTIC_UUID);

    clearCharacteristics();
    txCharacteristic = nextTx;
    rxCharacteristic = nextRx;

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener('characteristicvaluechanged', handleNotification);

    reconnectAttempt = 0;
    startKeepalive();
    emitConnectionChange();

    if (
      global.ClawPassword &&
      typeof global.ClawPassword.syncToDevice === 'function' &&
      !isNfcDeviceName(device.name) &&
      !isReceiverDevice(device.name)
    ) {
      global.ClawPassword.syncToDevice().catch(function () {});
    }

    return device.name || DEVICE_NAME;
  }

  async function trySetupDevice(device) {
    try {
      await setupGatt(device);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function reconnectKnownDevice() {
    if (isConnected()) {
      return true;
    }

    if (reconnectInProgress) {
      return reconnectInProgress;
    }

    reconnectInProgress = (async function () {
      if (bluetoothDevice && bluetoothDevice.gatt) {
        if (await trySetupDevice(bluetoothDevice)) {
          return true;
        }
      }

      if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
        emitConnectionChange();
        return false;
      }

      try {
        var devices = await navigator.bluetooth.getDevices();
        var rememberedId = getRememberedDeviceId();
        var remembered = [];
        var preferred = [];
        var others = [];

        for (var i = 0; i < devices.length; i++) {
          var device = devices[i];
          if (!device.gatt) {
            continue;
          }
          if (rememberedId && device.id === rememberedId) {
            remembered.push(device);
        } else if (KNOWN_DEVICE_NAMES.indexOf(device.name) >= 0) {
          preferred.push(device);
          } else {
            others.push(device);
          }
        }

        var ordered = remembered.concat(preferred, others);
        for (var j = 0; j < ordered.length; j++) {
          if (await trySetupDevice(ordered[j])) {
            return true;
          }
        }
      } catch (err) {
        // Keep bluetoothDevice for the next retry.
      }

      emitConnectionChange();
      return false;
    })();

    try {
      return await reconnectInProgress;
    } finally {
      reconnectInProgress = null;
    }
  }

  async function restoreConnection() {
    return reconnectKnownDevice();
  }

  async function connect() {
    return connectChat();
  }

  async function connectChat() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported');
    }

    manualDisconnect = false;
    clearTimeout(reconnectTimer);

    if (isConnected() && !isChatDeviceName(bluetoothDevice.name)) {
      await disconnect();
      manualDisconnect = false;
    }

    if (isConnected() && isChatDeviceName(bluetoothDevice.name)) {
      return bluetoothDevice.name;
    }

    var reconnected = await restoreChatConnection();
    if (reconnected) {
      return bluetoothDevice.name || DEVICE_NAME;
    }

    var device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID], name: DEVICE_NAME },
        { services: [SERVICE_UUID], namePrefix: 'XIAOChat' }
      ],
      optionalServices: [SERVICE_UUID],
    });

    return setupGatt(device);
  }

  async function restoreChatConnection() {
    if (isConnected() && isChatDeviceName(bluetoothDevice.name)) {
      return true;
    }

    if (bluetoothDevice && isChatDeviceName(bluetoothDevice.name)) {
      if (await trySetupDevice(bluetoothDevice)) {
        return true;
      }
    }

    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
      emitConnectionChange();
      return false;
    }

    try {
      var devices = await navigator.bluetooth.getDevices();
      var rememberedId = getRememberedDeviceId();

      for (var i = 0; i < devices.length; i++) {
        var device = devices[i];
        if (!device.gatt || !isChatDeviceName(device.name)) {
          continue;
        }
        if (rememberedId && device.id !== rememberedId) {
          continue;
        }
        if (await trySetupDevice(device)) {
          return true;
        }
      }

      for (var j = 0; j < devices.length; j++) {
        var fallback = devices[j];
        if (!fallback.gatt || !isChatDeviceName(fallback.name)) {
          continue;
        }
        if (await trySetupDevice(fallback)) {
          return true;
        }
      }
    } catch (err) {
      // fall through
    }

    emitConnectionChange();
    return false;
  }

  async function connectNfc() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported');
    }

    manualDisconnect = false;
    clearTimeout(reconnectTimer);

    if (isConnected() && !isNfcDeviceName(bluetoothDevice.name)) {
      await disconnect();
      manualDisconnect = false;
    }

    if (isConnected() && isNfcDeviceName(bluetoothDevice.name)) {
      return bluetoothDevice.name;
    }

    var device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID], name: NFC_DEVICE_NAME },
        { services: [SERVICE_UUID], namePrefix: 'XIAONFC' }
      ],
      optionalServices: [SERVICE_UUID],
    });

    return setupGatt(device);
  }

  function requireNfcDevice() {
    if (!isConnected()) {
      throw new Error('Not connected to XIAO NFC');
    }
    if (!isNfcDeviceName(bluetoothDevice.name)) {
      throw new Error('Wrong device: use XIAONFC, not ' + (bluetoothDevice.name || 'unknown'));
    }
  }

  async function disconnect() {
    manualDisconnect = true;
    clearTimeout(reconnectTimer);
    stopKeepalive();
    clearCharacteristics();

    if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
      bluetoothDevice.gatt.disconnect();
    }

    emitConnectionChange();

    setTimeout(function () {
      manualDisconnect = false;
    }, 1000);
  }

  async function send(text) {
    if (txBusy) {
      throw new Error('BLE busy');
    }
    txBusy = true;
    stopKeepalive();
    try {
      if (!isConnected()) {
        var ok = await reconnectKnownDevice();
        if (!ok) {
          throw new Error('Not connected');
        }
      }
      var encoder = new TextEncoder();
      await rxCharacteristic.writeValue(encoder.encode(text));
    } finally {
      txBusy = false;
      if (isConnected() && !manualDisconnect) {
        startKeepalive();
      }
    }
  }

  function normalizeBleMessage(message) {
    return String(message || '').trim();
  }

  function isNfcDeviceName(name) {
    return name === NFC_DEVICE_NAME;
  }

  function isChatDeviceName(name) {
    return name === DEVICE_NAME || (name && name.indexOf('XIAOChat') >= 0);
  }

  function isReceiverDevice(name) {
    if (!name) {
      return false;
    }
    return (
      name === RECEIVER_DEVICE_NAME ||
      name === 'XIAORecv' ||
      name.indexOf('CLAWRecv') === 0 ||
      name.indexOf('XIAORecv') === 0
    );
  }

  async function pullReceiverSignals() {
    if (!isConnected() || !isReceiverDevice(bluetoothDevice.name)) {
      return;
    }
    try {
      await send('PULL_SIGNALS');
    } catch (err) {
      // ignore
    }
  }

  async function connectReceiver() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported');
    }

    manualDisconnect = false;
    clearTimeout(reconnectTimer);

    if (isConnected() && !isReceiverDevice(bluetoothDevice.name)) {
      await disconnect();
      manualDisconnect = false;
    }

    if (isConnected() && isReceiverDevice(bluetoothDevice.name)) {
      await pullReceiverSignals();
      return bluetoothDevice.name;
    }

    if (bluetoothDevice && isReceiverDevice(bluetoothDevice.name)) {
      if (await trySetupDevice(bluetoothDevice)) {
        await pullReceiverSignals();
        return bluetoothDevice.name;
      }
    }

    if (navigator.bluetooth.getDevices) {
      try {
        var devices = await navigator.bluetooth.getDevices();
        for (var i = 0; i < devices.length; i++) {
          if (isReceiverDevice(devices[i].name) && await trySetupDevice(devices[i])) {
            await pullReceiverSignals();
            return bluetoothDevice.name;
          }
        }
      } catch (err) {
        // fall through to picker
      }
    }

    var device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });
    } catch (err) {
      throw err;
    }

    if (!isReceiverDevice(device.name)) {
      throw new Error('Choose CLAWRecv (receiver), not ' + (device.name || 'unknown'));
    }

    var name = await setupGatt(device);
    await pullReceiverSignals();
    return name;
  }

  function waitForAck(expected, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        offMessage(handler);
        reject(new Error('BLE timeout'));
      }, timeoutMs || 5000);

      function handler(message) {
        if (message === '__DISCONNECTED__') {
          clearTimeout(timer);
          offMessage(handler);
          reject(new Error('BLE disconnected'));
          return;
        }

        var normalized = normalizeBleMessage(message);
        if (normalized === expected) {
          clearTimeout(timer);
          offMessage(handler);
          resolve(normalized);
          return;
        }

        if (normalized.indexOf('ERR|') === 0) {
          clearTimeout(timer);
          offMessage(handler);
          reject(new Error(normalized.substring(4) || 'BLE error'));
        }
      }

      onMessage(handler);
    });
  }

  async function sendAndWaitForAck(text, expected, timeoutMs) {
    if (txBusy) {
      throw new Error('BLE busy');
    }
    txBusy = true;
    stopKeepalive();
    try {
      if (!isConnected()) {
        var ok = await reconnectKnownDevice();
        if (!ok) {
          throw new Error('Not connected');
        }
      }
      var ackPromise = waitForAck(expected, timeoutMs);
      var encoder = new TextEncoder();
      await rxCharacteristic.writeValue(encoder.encode(text));
      return await ackPromise;
    } finally {
      txBusy = false;
      if (isConnected() && !manualDisconnect) {
        startKeepalive();
      }
    }
  }

  function startHealthCheck() {
    if (healthTimer) {
      return;
    }
    healthTimer = setInterval(function () {
      if (manualDisconnect) {
        return;
      }
      if (isConnected()) {
        return;
      }
      if (bluetoothDevice || getRememberedDeviceId() || (navigator.bluetooth && navigator.bluetooth.getDevices)) {
        reconnectKnownDevice().catch(function () {});
      }
    }, HEALTH_CHECK_MS);
  }

  function onPageVisible() {
    if (manualDisconnect) {
      return;
    }
    reconnectKnownDevice().catch(function () {});
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        onPageVisible();
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', function (event) {
      if (event.persisted) {
        onPageVisible();
      }
    });
    window.addEventListener('focus', onPageVisible);
  }

  global.ClawBle = {
    connect: connect,
    connectChat: connectChat,
    connectNfc: connectNfc,
    connectReceiver: connectReceiver,
    restoreChatConnection: restoreChatConnection,
    requireNfcDevice: requireNfcDevice,
    isChatDevice: function () {
      return isConnected() && isChatDeviceName(bluetoothDevice.name);
    },
    isNfcDevice: function () {
      return isConnected() && isNfcDeviceName(bluetoothDevice.name);
    },
    isReceiverDevice: function () {
      return isConnected() && isReceiverDevice(bluetoothDevice.name);
    },
    reconnect: reconnectKnownDevice,
    restoreConnection: restoreConnection,
    disconnect: disconnect,
    send: send,
    sendAndWaitForAck: sendAndWaitForAck,
    isConnected: isConnected,
    isKnownDevice: isKnownDevice,
    getDeviceName: getDeviceName,
    waitForAck: waitForAck,
    onMessage: onMessage,
    offMessage: offMessage,
    onConnectionChange: onConnectionChange,
    offConnectionChange: offConnectionChange,
    startHealthCheck: startHealthCheck,
  };

  startHealthCheck();
})(window);
