/* Independent, keyboard-accessible mobile navigation. */
(() => {
 const toggles = Array.from(document.querySelectorAll('.header-burger-btn'));
 const menu = document.querySelector('.header-menu');
 if (!toggles.length || !menu) return;
 menu.id = 'mobile-navigation';
 let isOpen = false;
 let opener;
 const setOpen = open => {
   isOpen = open;
   document.body.classList.toggle('header--menu-open', open);
   document.querySelector('#header')?.classList.toggle('header--menu-open', open);
   toggles.forEach(toggle => {
     toggle.setAttribute('aria-controls', menu.id);
     toggle.setAttribute('aria-expanded', String(open));
     toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
   });
   menu.setAttribute('aria-hidden', String(!open));
   menu.inert = !open;
   if (open) menu.querySelector('a')?.focus();
 };
 setOpen(false);
 toggles.forEach(toggle => toggle.addEventListener('click', () => {opener=toggle;setOpen(!isOpen);}));
 menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
 document.addEventListener('keydown', e => {
   if (e.key === 'Escape' && isOpen) { setOpen(false); opener?.focus(); }
   if (e.key === 'Tab' && isOpen) {
     const focusable = [...toggles.filter(t=>t.getClientRects().length),...menu.querySelectorAll('a[href]')];
     const first=focusable[0],last=focusable[focusable.length-1];
     if (e.shiftKey && document.activeElement===first) {e.preventDefault();last.focus();}
     if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
   }
 });
 window.matchMedia('(min-width: 800px)').addEventListener('change', e => { if (e.matches) setOpen(false); });
})();
