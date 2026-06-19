const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusDiv = document.getElementById('status');
const chatSection = document.getElementById('chatSection');

function addMessage(text, type) {
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const timestamp = new Date().toLocaleTimeString();
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.innerHTML = `
    ${text}
    <span class="message-time">${timestamp}</span>
  `;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateStatus(connected, deviceName) {
  if (connected) {
    statusDiv.textContent = `Connected to ${deviceName || 'Device'}`;
    statusDiv.className = 'status connected';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'block';
    chatSection.classList.add('active');
    messageInput.focus();
  } else {
    statusDiv.textContent = 'Disconnected';
    statusDiv.className = 'status disconnected';
    connectBtn.style.display = 'block';
    disconnectBtn.style.display = 'none';
    chatSection.classList.remove('active');
  }
}

function handleBleMessage(message) {
  if (message === '__DISCONNECTED__') {
    addMessage('Device disconnected', 'received');
    return;
  }
  addMessage(message, 'received');
}

async function connect() {
  if (!window.ClawBle) {
    addMessage('Error: BLE client not loaded', 'received');
    return;
  }

  try {
    addMessage('Connecting to CLAW…', 'received');
    const name = await ClawBle.connect();
    addMessage(`Connected to ${name}`, 'received');
    addMessage('You can now send messages.', 'received');
  } catch (error) {
    addMessage(`Error: ${error.message}`, 'received');
    console.error('Connection error:', error);
  }
}

async function disconnect() {
  if (!window.ClawBle) {
    return;
  }
  addMessage('Disconnecting...', 'received');
  await ClawBle.disconnect();
}

async function sendMessage() {
  const message = messageInput.value.trim();

  if (!message) {
    return;
  }

  if (!window.ClawBle || !ClawBle.isConnected()) {
    addMessage('Error: Not connected to device', 'received');
    return;
  }

  try {
    await ClawBle.send(message);
    addMessage(message, 'sent');
    messageInput.value = '';
    messageInput.focus();
  } catch (error) {
    addMessage(`Error sending: ${error.message}`, 'received');
    console.error('Send error:', error);
  }
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

if (!navigator.bluetooth) {
  addMessage('Web Bluetooth API is not available in this browser', 'received');
  connectBtn.disabled = true;
  statusDiv.textContent = 'Web Bluetooth not supported';
  statusDiv.className = 'status disconnected';
} else if (window.ClawBle) {
  ClawBle.onMessage(handleBleMessage);
  ClawBle.onConnectionChange(updateStatus);
  updateStatus(ClawBle.isConnected(), ClawBle.getDeviceName());
  ClawBle.restoreConnection()
    .then(function () {
      updateStatus(ClawBle.isConnected(), ClawBle.getDeviceName());
    })
    .catch(function () {
      updateStatus(ClawBle.isConnected(), ClawBle.getDeviceName());
    });
}
