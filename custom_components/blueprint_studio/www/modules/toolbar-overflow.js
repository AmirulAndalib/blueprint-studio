const OVERFLOW_CLASS = 'toolbar-overflow-hidden';
const MENU_ITEM_SELECTOR = '.toolbar-overflow-menu-item';

let initialized = false;

function commandParts(control) {
  const fullLabel = control.dataset.toolbarLabel || control.getAttribute('aria-label') || control.dataset.tooltip || '';
  const suffixMatch = fullLabel.match(/\s*\(([^()]*)\)\s*$/);
  const shortcutMatch = suffixMatch && /(?:Ctrl|Cmd|Alt|Option|Shift|Meta|F\d)/i.test(suffixMatch[1])
    ? suffixMatch
    : null;
  return {
    label: shortcutMatch ? fullLabel.slice(0, shortcutMatch.index).trim() : fullLabel,
    shortcut: shortcutMatch?.[1] || '',
  };
}

function commandIsAvailable(control) {
  return getComputedStyle(control).display !== 'none';
}

function menuItems(menu) {
  return [...menu.querySelectorAll(MENU_ITEM_SELECTOR)];
}

export function initToolbarOverflow(root = document) {
  if (initialized) return;
  const toolbar = root.querySelector('.toolbar');
  const overflowGroup = root.querySelector('.toolbar-group--overflow');
  const trigger = root.getElementById('btn-toolbar-overflow');
  const menu = root.getElementById('toolbar-overflow-menu');
  if (!toolbar || !overflowGroup || !trigger || !menu) return;
  initialized = true;

  const commandGroups = [...toolbar.querySelectorAll(':scope > .toolbar-group[data-toolbar-priority]')];
  let hiddenGroups = [];
  let layoutFrame = null;

  const closeMenu = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const positionMenu = () => {
    if (document.body.dataset.workspaceMode === 'phone') {
      menu.style.removeProperty('left');
      menu.style.removeProperty('top');
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(window.innerWidth - menuRect.width - margin, Math.max(margin, rect.right - menuRect.width));
    const below = rect.bottom + margin;
    const top = below + menuRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, rect.top - menuRect.height - margin);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const rebuildMenu = () => {
    menu.replaceChildren();
    const header = document.createElement('div');
    header.className = 'toolbar-overflow-menu-header';
    header.setAttribute('role', 'presentation');
    const heading = document.createElement('span');
    heading.className = 'toolbar-overflow-menu-heading';
    heading.textContent = commandParts(trigger).label || 'More commands';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'toolbar-overflow-menu-close';
    closeButton.setAttribute('aria-label', `Close ${heading.textContent.toLowerCase()}`);
    closeButton.innerHTML = '<span class="ui-icon material-icons" aria-hidden="true">close</span>';
    closeButton.addEventListener('click', () => closeMenu(true));
    header.append(heading, closeButton);
    menu.appendChild(header);

    hiddenGroups.forEach((group) => {
      const controls = [...group.querySelectorAll(':scope > button')].filter(commandIsAvailable);
      if (!controls.length) return;
      const groupLabel = group.getAttribute('aria-label');
      if (groupLabel) {
        const section = document.createElement('div');
        section.className = 'toolbar-overflow-menu-section';
        section.setAttribute('role', 'presentation');
        section.textContent = groupLabel;
        menu.appendChild(section);
      }
      controls.forEach((control) => {
        const item = document.createElement('button');
        const { label, shortcut } = commandParts(control);
        item.type = 'button';
        item.className = 'ui-menu__item toolbar-overflow-menu-item';
        item.setAttribute('role', 'menuitem');
        item.dataset.commandId = control.id;
        item.setAttribute('aria-disabled', String(control.disabled));
        item.setAttribute('aria-label', control.getAttribute('aria-label') || label);
        item.title = control.dataset.disabledReason || '';

        const sourceIcon = control.querySelector('.ui-icon, .octicon');
        if (sourceIcon) item.appendChild(sourceIcon.cloneNode(true));
        const labelNode = document.createElement('span');
        labelNode.className = 'toolbar-overflow-menu-label';
        labelNode.textContent = label;
        item.appendChild(labelNode);
        if (shortcut) {
          const shortcutNode = document.createElement('span');
          shortcutNode.className = 'toolbar-overflow-menu-shortcut';
          shortcutNode.textContent = shortcut;
          item.appendChild(shortcutNode);
        }
        item.addEventListener('click', () => {
          if (control.disabled) return;
          closeMenu();
          control.click();
        });
        menu.appendChild(item);
      });
    });
  };

  const layout = () => {
    layoutFrame = null;
    commandGroups.forEach((group) => group.classList.remove(OVERFLOW_CLASS));
    overflowGroup.classList.add('is-needed');
    hiddenGroups = [];

    const candidates = commandGroups
      .filter((group) => getComputedStyle(group).display !== 'none')
      .sort((left, right) => {
        const priorityDifference = Number(right.dataset.toolbarPriority) - Number(left.dataset.toolbarPriority);
        return priorityDifference || commandGroups.indexOf(right) - commandGroups.indexOf(left);
      });

    for (const group of candidates) {
      if (toolbar.scrollWidth <= toolbar.clientWidth) break;
      group.classList.add(OVERFLOW_CLASS);
      hiddenGroups.push(group);
    }

    overflowGroup.classList.toggle('is-needed', hiddenGroups.length > 0);
    toolbar.scrollLeft = 0;
    rebuildMenu();
    if (!hiddenGroups.length) closeMenu();
  };

  const scheduleLayout = () => {
    if (layoutFrame !== null) return;
    layoutFrame = window.requestAnimationFrame(layout);
  };

  const openMenu = () => {
    if (!hiddenGroups.length) return;
    rebuildMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu();
  };

  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu();
      menuItems(menu)[0]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = menuItems(menu);
    const currentIndex = items.indexOf(document.activeElement);
    let targetIndex = null;
    if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') targetIndex = 0;
    if (event.key === 'End') targetIndex = items.length - 1;
    if (targetIndex !== null && items.length) {
      event.preventDefault();
      items[targetIndex].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('scroll', (event) => {
    if (menu.contains(event.target)) return;
    closeMenu();
  }, true);

  const mutations = new MutationObserver((records) => {
    const externalChange = records.some((record) => {
      if (record.attributeName !== 'class') return true;
      const normalize = (value) => (value || '').split(/\s+/).filter((name) => name && name !== OVERFLOW_CLASS).sort().join(' ');
      return normalize(record.oldValue) !== normalize(record.target.className);
    });
    if (externalChange) scheduleLayout();
    else rebuildMenu();
  });
  commandGroups.forEach((group) => {
    mutations.observe(group, { attributes: true, attributeOldValue: true, subtree: true });
  });

  layout();
}
