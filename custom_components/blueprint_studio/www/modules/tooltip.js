const TOOLTIP_ID = "ui-tooltip-popup";
const TOOLTIP_DELAY_MS = 350;
const VIEWPORT_MARGIN = 8;

let initialized = false;

export function setOverflowTooltip(trigger, content, overflowTarget = trigger) {
  if (!trigger || !overflowTarget || !content) return;
  trigger.dataset.overflowTooltip = content;
  overflowTarget.dataset.overflowTooltipTarget = "true";
}

export function initTooltips(root = document) {
  if (initialized) return;
  initialized = true;

  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.className = "ui-tooltip-popup";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let activeTrigger = null;
  let previousDescription = null;
  let showTimer = null;

  const clearShowTimer = () => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    showTimer = null;
  };

  const hide = () => {
    clearShowTimer();
    if (activeTrigger) {
      if (previousDescription) activeTrigger.setAttribute("aria-describedby", previousDescription);
      else activeTrigger.removeAttribute("aria-describedby");
    }
    activeTrigger = null;
    previousDescription = null;
    tooltip.hidden = true;
  };

  const position = (trigger) => {
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, triggerRect.left + (triggerRect.width - tooltipRect.width) / 2),
    );
    let top = triggerRect.bottom + VIEWPORT_MARGIN;
    if (top + tooltipRect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = triggerRect.top - tooltipRect.height - VIEWPORT_MARGIN;
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.max(VIEWPORT_MARGIN, Math.round(top))}px`;
  };

  const show = (trigger) => {
    const content = (trigger?.dataset.tooltip || trigger?.dataset.overflowTooltip || trigger?.textContent)?.trim();
    if (!content || trigger.getAttribute("aria-disabled") === "true") return;
    if (trigger.dataset.overflowTooltip !== undefined) {
      const overflowTarget = trigger.querySelector("[data-overflow-tooltip-target]") || trigger;
      const isTruncated = overflowTarget.scrollWidth > overflowTarget.clientWidth + 1 ||
        overflowTarget.scrollHeight > overflowTarget.clientHeight + 1;
      if (!isTruncated) return;
    }
    if (activeTrigger === trigger) {
      tooltip.textContent = content;
      tooltip.hidden = false;
      position(trigger);
      return;
    }
    if (activeTrigger && activeTrigger !== trigger) hide();
    activeTrigger = trigger;
    previousDescription = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", TOOLTIP_ID);
    tooltip.textContent = content;
    tooltip.hidden = false;
    position(trigger);
  };

  const findTrigger = (target) => target instanceof Element
    ? target.closest("[data-tooltip], [data-overflow-tooltip]")
    : null;

  root.addEventListener("pointerover", (event) => {
    const trigger = findTrigger(event.target);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    clearShowTimer();
    showTimer = window.setTimeout(() => show(trigger), TOOLTIP_DELAY_MS);
  });
  root.addEventListener("pointerout", (event) => {
    const trigger = findTrigger(event.target);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    hide();
  });
  root.addEventListener("focusin", (event) => show(findTrigger(event.target)));
  root.addEventListener("focusout", (event) => {
    if (findTrigger(event.target) === activeTrigger) hide();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeTrigger) hide();
  });
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", hide, true);
}
