function prebaciTemu() {
  const trenutna = document.documentElement.getAttribute('data-tema');
  const nova = trenutna === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-tema', nova);
  localStorage.setItem('gomteh-tema', nova);
}
