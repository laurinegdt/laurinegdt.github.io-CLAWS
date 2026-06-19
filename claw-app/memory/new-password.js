(function () {
  var form = document.getElementById('new-password-form');
  var nameInput = document.getElementById('password-name');
  var valueInput = document.getElementById('password-value');
  var toggle = document.getElementById('password-toggle');
  var iconShow = toggle.querySelector('.password-input-wrap__icon--show');
  var iconHide = toggle.querySelector('.password-input-wrap__icon--hide');

  toggle.addEventListener('click', function () {
    var visible = valueInput.type === 'text';
    valueInput.type = visible ? 'password' : 'text';
    toggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
    toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    iconShow.hidden = !visible;
    iconHide.hidden = visible;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameInput.value.trim();
    var password = valueInput.value;
    if (!name) {
      nameInput.focus();
      return;
    }
    if (!password) {
      valueInput.focus();
      return;
    }
    ClawPassword.setPendingPassword(name, password);
    window.location.href = 'password-activate.html';
  });
})();
