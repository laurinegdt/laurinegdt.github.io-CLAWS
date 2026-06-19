(function (global) {
  function guardSelected(fallbackUrl) {
    if (!global.ClawStorage) {
      return false;
    }
    return ClawStorage.requireSelectedOrRedirect(
      fallbackUrl || '../my-claw/my-claws.html'
    );
  }

  function resolveBackTarget(target) {
    if (!global.ClawStorage) {
      return null;
    }
    var claw = ClawStorage.getSelectedClaw();
    var clawId = claw && claw.id;

    switch (target) {
      case 'claws':
        return '../my-claw/my-claws.html';
      case 'claw':
        return clawId ? ClawStorage.getClawDetailUrl(clawId) : '../my-claw/my-claws.html';
      case 'modifier':
        return '../menu/add-claw.html';
      case 'assign-password':
        return '../my-claw/assign-password.html';
      case 'assign-nfc':
        return '../my-claw/assign-nfc.html';
      case 'menu':
        return '../menu/menu.html';
      default:
        return null;
    }
  }

  function initBackLinks() {
    document.querySelectorAll('[data-claw-back]').forEach(function (el) {
      var href = resolveBackTarget(el.getAttribute('data-claw-back'));
      if (href) {
        el.setAttribute('href', href);
      }
    });
  }

  function initContextLabel(selector) {
    if (!global.ClawStorage) {
      return;
    }
    var claw = ClawStorage.getSelectedClaw();
    if (!claw) {
      return;
    }
    document.querySelectorAll(selector).forEach(function (el) {
      el.textContent = claw.label;
    });
  }

  function boot(options) {
    options = options || {};
    if (options.guard && !guardSelected(options.fallbackUrl)) {
      return false;
    }
    initBackLinks();
    if (options.labelSelector) {
      initContextLabel(options.labelSelector);
    }
    return true;
  }

  global.ClawContext = {
    guardSelected: guardSelected,
    initBackLinks: initBackLinks,
    initContextLabel: initContextLabel,
    boot: boot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (shouldAutoGuard()) {
        boot({ guard: true });
      } else if (document.querySelector('[data-claw-back]')) {
        initBackLinks();
      }
    });
  } else if (shouldAutoGuard()) {
    boot({ guard: true });
  } else if (document.querySelector('[data-claw-back]')) {
    initBackLinks();
  }

  function shouldAutoGuard() {
    if (!document.body || !document.body.hasAttribute('data-claw-guard')) {
      return false;
    }
    var params = new URLSearchParams(window.location.search);
    return params.get('new') !== '1';
  }
})(window);
