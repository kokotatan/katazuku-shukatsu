const menu = document.querySelector('.menu-button');
const navigation = document.querySelector('.nav');
function closeMenu() { navigation?.classList.remove('open'); menu?.setAttribute('aria-expanded', 'false'); }
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
navigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.querySelectorAll('.copy-button').forEach(button => {
  button.addEventListener('click', async () => {
    const code = button.closest('.code-block').querySelector('code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'コピーしました';
      document.querySelector('#copy-status').textContent = 'コマンドをコピーしました。';
      setTimeout(() => { button.textContent = 'コピー'; }, 2200);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      document.querySelector('#copy-status').textContent = '文字を選択しました。コピー操作をしてください。';
    }
  });
});
document.querySelectorAll('[data-os-choice]').forEach(button => {
  button.addEventListener('click', () => {
    const choice = button.dataset.osChoice;
    document.querySelectorAll('[data-os-choice]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-os]').forEach(item => { item.hidden = item.dataset.os !== choice; });
  });
});
