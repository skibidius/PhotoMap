// Material 3 plain tooltips. One shared element is positioned next to the
// hovered/focused control after a short delay.

import { t } from './i18n';

let tip: HTMLDivElement | null = null;
let showTimer: number | undefined;
let current: HTMLElement | null = null;

function labelFor(el: HTMLElement): string {
  const key = el.dataset.i18nTitle;
  if (key) return t(key);
  return el.dataset.tooltip ?? el.getAttribute('aria-label') ?? '';
}

function place(el: HTMLElement): void {
  if (!tip) return;
  const r = el.getBoundingClientRect();
  tip.style.left = '0px';
  tip.style.top = '0px';
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;

  let x = r.left + r.width / 2 - tw / 2;
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;

  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

function show(el: HTMLElement): void {
  if (!tip) return;
  const text = labelFor(el);
  if (!text) return;
  tip.textContent = text;
  tip.classList.remove('hidden');
  place(el);
  requestAnimationFrame(() => {
    place(el);
    tip?.classList.add('visible');
  });
}

function hide(): void {
  if (!tip) return;
  tip.classList.remove('visible');
  tip.classList.add('hidden');
}

function targetOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>('[data-i18n-title], [data-tooltip]');
}

function schedule(el: HTMLElement): void {
  clearTimeout(showTimer);
  current = el;
  showTimer = window.setTimeout(() => show(el), 380);
}

export function initTooltips(): void {
  tip = document.createElement('div');
  tip.id = 'tooltip';
  tip.className = 'tooltip hidden';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  document.addEventListener('mouseover', (e) => {
    const el = targetOf(e.target);
    if (!el || el === current) return;
    schedule(el);
  });

  document.addEventListener('mouseout', (e) => {
    const el = targetOf(e.target);
    if (!el || el !== current) return;
    clearTimeout(showTimer);
    current = null;
    hide();
  });

  document.addEventListener('focusin', (e) => {
    const el = targetOf(e.target);
    if (!el) return;
    clearTimeout(showTimer);
    current = el;
    show(el);
  });

  document.addEventListener('focusout', (e) => {
    if (targetOf(e.target) !== current) return;
    clearTimeout(showTimer);
    current = null;
    hide();
  });

  document.addEventListener('click', () => {
    clearTimeout(showTimer);
    current = null;
    hide();
  });

  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
